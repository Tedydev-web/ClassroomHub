/**
 * Host-authoritative tenant routing: the standard multi-tenant defence where the
 * host, not a session store or a URL param, decides which tenant a request
 * belongs to. Each org's people work on that org's own host; the platform
 * operator works on the hub host. Because the app serves every route on every
 * host and auth cookies are host-only, landing on the wrong host lets a session
 * form in the wrong place — so this bounces a request to the right host before
 * that happens.
 *
 * This module is pure and side-effect free on purpose: the redirect DECISION is
 * where correctness lives (no loops, no operator lockout, invites untouched), so
 * it is unit-tested exhaustively and the hook that wires it in stays a thin
 * adapter.
 *
 * Off unless `ENFORCE_TENANT_HOST` is on. It is a dark-launch guard: ship the
 * tested logic, enable it in one environment, watch, roll back with a flag flip.
 */

export type TenantHostRedirectInput = {
  /** Whole flag; when false the guard is inert and always returns null. */
  enabled: boolean;
  /** Request hostname, e.g. `msna.classroom.io.vn` or `hub.classroom.io.vn`. */
  hostname: string;
  /** Path plus query, preserved across the redirect, e.g. `/lms?tab=x`. */
  pathAndSearch: string;
  /** Only authenticated app traffic is guarded; anon traffic hits the login flow. */
  isAuthenticated: boolean;
  /** Public routes (login, invite accept, enroll, public course) are never bounced. */
  isPublicPath: boolean;
  /** Signed-in user's email, matched against the operator allowlist. */
  userEmail: string | null;
  /** Site names of every org the user belongs to. */
  memberSiteNames: string[];
  /** The user's home org site name — where a bounce sends them. Null if none. */
  homeSiteName: string | null;
  /** Operator allowlist. Members are never bounced — they run the hub console. */
  platformAdminEmails: string[];
  /** The operator/platform host, e.g. `hub.classroom.io.vn`. */
  hubHost: string;
  /** The tenant root domain, e.g. `classroom.io.vn`. */
  tenantRoot: string;
};

export type TenantHostRedirect = { location: string } | null;

/** Which kind of host this is, and (for a tenant) which org's subdomain. */
type HostKind = { kind: 'hub' } | { kind: 'tenant'; siteName: string } | { kind: 'other' };

/**
 * Classify a hostname against the platform's own hosts. `other` covers custom
 * domains, localhost, and the apex — hosts this guard deliberately leaves alone,
 * because they are either an org's own verified domain or not a tenant host at
 * all.
 */
export function classifyHost(hostname: string, hubHost: string, tenantRoot: string): HostKind {
  const host = hostname.toLowerCase();

  if (host === hubHost.toLowerCase()) return { kind: 'hub' };

  const suffix = `.${tenantRoot.toLowerCase()}`;
  if (host.endsWith(suffix)) {
    const label = host.slice(0, -suffix.length);
    // A single label under the root is a tenant subdomain; deeper names
    // (`a.b.classroom.io.vn`) or the bare apex are not tenants.
    if (label && !label.includes('.')) return { kind: 'tenant', siteName: label };
  }

  return { kind: 'other' };
}

/** Case-insensitive membership test against the operator allowlist. */
export function isPlatformAdminEmail(email: string | null, allowlist: string[]): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();

  return allowlist.some((entry) => entry.trim().toLowerCase() === normalized);
}

/**
 * Decide where, if anywhere, to send an authenticated request so its host
 * matches its tenant. Returns null to leave the request where it is.
 *
 * Guarantees, all covered by the test suite:
 *  - Operators are never bounced — no lockout from the hub console.
 *  - Public paths (login, invite accept, enroll) are never bounced — a not-yet
 *    member accepting an invite on a tenant host must not be redirected away.
 *  - No redirect loop: a bounce always targets a host the user is a member of
 *    (their home org), which then returns null.
 *  - Custom domains, localhost, and the apex are left untouched.
 */
export function resolveTenantHostRedirect(input: TenantHostRedirectInput): TenantHostRedirect {
  if (!input.enabled) return null;
  if (!input.isAuthenticated) return null;
  if (input.isPublicPath) return null;
  if (isPlatformAdminEmail(input.userEmail, input.platformAdminEmails)) return null;

  const host = classifyHost(input.hostname, input.hubHost, input.tenantRoot);

  if (host.kind === 'other') return null;

  const bounceHome = (): TenantHostRedirect =>
    input.homeSiteName ? { location: `https://${input.homeSiteName}.${input.tenantRoot}${input.pathAndSearch}` } : null;

  if (host.kind === 'hub') {
    // A non-operator with an org has no business on the operator host; send them
    // to their own org site. With no org there is nowhere to send them, so they
    // stay (onboarding / create-org lives on the platform host).
    return bounceHome();
  }

  // host.kind === 'tenant'
  if (input.memberSiteNames.some((name) => name.toLowerCase() === host.siteName.toLowerCase())) {
    return null; // Member of this tenant — already on the right host.
  }

  // Authenticated but not a member of this tenant → send to their own org.
  // (A not-yet-member accepting an invite is a public path, handled above.)
  return bounceHome();
}

type OrgHostFields = { siteName?: string | null; parentOrganizationId?: string | null };

/** Site names of every org the user can be on. Sub-workspaces count too. */
export function memberSiteNames(orgs: OrgHostFields[]): string[] {
  return orgs.map((org) => org.siteName).filter((name): name is string => Boolean(name));
}

/**
 * The org whose host is a user's "home" — where a bounce sends them. Prefers a
 * top-level org (no parent) so a bounce lands on a primary workspace rather than
 * a sub-workspace; falls back to any org with a site name.
 */
export function pickHomeSiteName(orgs: OrgHostFields[]): string | null {
  const topLevel = orgs.find((org) => !org.parentOrganizationId && org.siteName);
  if (topLevel?.siteName) return topLevel.siteName;

  return orgs.find((org) => org.siteName)?.siteName ?? null;
}
