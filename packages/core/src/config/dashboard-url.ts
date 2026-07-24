import { DASHBOARD_HOST, TENANT_ROOT_DOMAIN } from '@cio/utils/constants/domains';

import { env } from './env';

/**
 * Host helpers for links embedded in emails and other outbound URLs.
 *
 * Email templates only receive pre-built URLs in their `fields` — callers in
 * `apps/api` (or other services) choose the host here before enqueueing mail.
 *
 * Two hosts, two audiences, and they must never cross:
 *
 * - **An org's own site** (`getDashboardBaseUrl(org)`) — where that org's
 *   people work: both its learners (`/lms`) and its staff (`/org/<siteName>`,
 *   grading, course building). Resolves to the org custom domain, else its
 *   tenant subdomain. Use for every org-scoped email, whoever the recipient is.
 * - **The platform host** (`getAppBaseUrl()`) — `hub.<root>`, the operator's
 *   console for managing tenants. Use only for platform/super-admin links,
 *   never for anything scoped to a single org.
 *
 * Getting this wrong is a security problem, not a cosmetic one: the app serves
 * every route on every host and sessions are host-only, so the host a link
 * opens on is where the recipient's session forms. An org link pointing at the
 * platform host — or a platform link at a tenant — puts a session on the wrong
 * domain.
 *
 * See `packages/email/README.md` and `AGENTS.md` § Email link URLs.
 */

/**
 * Minimal org shape consumed by `getDashboardBaseUrl`. Accepts the three
 * fields that decide which host the org's URLs live on. All optional so
 * callers without an org context can still ask for a sensible default.
 */
export type DashboardOrg = {
  siteName?: string | null;
  customDomain?: string | null;
  isCustomDomainVerified?: boolean | null;
};

/**
 * True when `DASHBOARD_ORIGIN` is itself a host on the platform root domain
 * (e.g. `hub.classroom.io.vn` under `classroom.io.vn`).
 *
 * That is the signal that this deployment IS the multi-tenant platform, so a
 * `<siteName>.<root>` subdomain is a real sibling host and should win over the
 * platform-wide origin for an org's own links. A self-hosted install whose
 * origin is its own domain (e.g. `learn.acme.com`) fails this check, and keeps
 * `DASHBOARD_ORIGIN` authoritative — it has no routable tenant subdomains under
 * the product root. Deriving this from the origin, rather than a deployment
 * flag, keeps it correct even when `PUBLIC_IS_SELF_OWNED` is left at its
 * example default.
 */
function dashboardOriginIsOnTenantRoot(): boolean {
  if (!env.DASHBOARD_ORIGIN) return false;

  try {
    const host = new URL(env.DASHBOARD_ORIGIN).hostname;
    return host === TENANT_ROOT_DOMAIN || host.endsWith(`.${TENANT_ROOT_DOMAIN}`);
  } catch {
    return false;
  }
}

/**
 * Returns the base URL of an org's own site — where that org's learners and
 * staff both operate. Use for every org-scoped email link.
 *
 * Resolution order (highest precedence first):
 *  1. Org's verified `customDomain`  → `https://<customDomain>`
 *  2. Tenant `siteName`, when the platform is itself on the tenant root domain
 *                                    → `https://<siteName>.<tenant root>`
 *  3. `DASHBOARD_ORIGIN` env var      → that value (self-hosted override / dev)
 *  4. `NODE_ENV === 'development'`    → `http://localhost:8000`
 *  5. Org's `siteName`                → `https://<siteName>.<tenant root>`
 *  6. Final fallback                  → the platform host
 *
 * A verified `customDomain` (1) and, on the platform, a tenant `siteName` (2)
 * both outrank `DASHBOARD_ORIGIN`: a per-org URL must beat the platform-wide
 * host for that org's links. Without step 2, `DASHBOARD_ORIGIN` (the platform
 * host, `hub.<root>`) captured every org link and sent its people to the
 * operator console instead of their own org site.
 */
export function getDashboardBaseUrl(org?: DashboardOrg): string {
  if (org?.customDomain && org.isCustomDomainVerified) {
    return `https://${org.customDomain}`;
  }

  if (org?.siteName && dashboardOriginIsOnTenantRoot()) {
    return `https://${org.siteName}.${TENANT_ROOT_DOMAIN}`;
  }

  if (env.DASHBOARD_ORIGIN) {
    return env.DASHBOARD_ORIGIN.replace(/\/$/, '');
  }

  if (env.NODE_ENV === 'development') {
    return 'http://localhost:8000';
  }

  if (org?.siteName) {
    return `https://${org.siteName}.${TENANT_ROOT_DOMAIN}`;
  }

  return `https://${DASHBOARD_HOST}`;
}

/**
 * Returns the platform host (`hub.<root>`) — the operator's tenant-management
 * console.
 *
 * Use only for platform/super-admin links that are not scoped to any single
 * org. Every org-scoped link — including staff actions like team invites and
 * grading, which happen on the org's own site — must use
 * `getDashboardBaseUrl(org)` instead, or it will point a recipient's session at
 * the operator host.
 */
export function getAppBaseUrl(): string {
  return getDashboardBaseUrl();
}
