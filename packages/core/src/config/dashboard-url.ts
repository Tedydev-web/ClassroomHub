import { DASHBOARD_HOST, TENANT_ROOT_DOMAIN } from '@cio/utils/constants/domains';

import { env } from './env';
import { isSelfOwnedDeployment } from './deployment';

/**
 * Dashboard host helpers for links embedded in emails and other outbound URLs.
 *
 * Email templates only receive pre-built URLs in their `fields` — callers in
 * `apps/api` (or other services) choose the host here before enqueueing mail.
 *
 * - **Student/learner links** (course enroll, audience invites, login):
 *   `getDashboardBaseUrl(org)` — org custom domain, tenant subdomain, or fallback.
 * - **Teacher/tutor/admin dashboard actions** (course management, grading, team
 *   invites, auto-enroll): `getAppBaseUrl()` — configured ClassroomHub admin app.
 *   Do not pass org `customDomain` or tenant `siteName`.
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
 * Returns the learner-facing dashboard base URL for an org.
 *
 * Use for **student/learner email links** (course enroll, audience invites,
 * login) so links land on the org's public site.
 *
 * Resolution order (highest precedence first):
 *  1. Org's verified `customDomain`   → `https://<customDomain>`
 *  2. Hosted tenant `siteName`         → `https://<siteName>.<tenant root>`
 *     (self-owned production only)
 *  3. `DASHBOARD_ORIGIN` env var       → that value (self-hosted override)
 *  4. `NODE_ENV === 'development'`     → `http://localhost:8000`
 *  5. Org's `siteName`                 → `https://<siteName>.<tenant root>`
 *  6. Final fallback                   → configured product dashboard host
 *
 * Both `customDomain` and a hosted tenant `siteName` win over `DASHBOARD_ORIGIN`
 * for the same reason: a per-org URL must override the platform-wide dashboard
 * host for that org's links. Without step 2, `DASHBOARD_ORIGIN` (the admin host,
 * e.g. `hub.<root>`) captured every student invite and sent learners to the
 * platform host instead of their own org site.
 *
 * For teacher/tutor/admin dashboard actions in email, use `getAppBaseUrl()`.
 */
export function getDashboardBaseUrl(org?: DashboardOrg): string {
  if (org?.customDomain && org.isCustomDomainVerified) {
    return `https://${org.customDomain}`;
  }

  // A tenant's own subdomain is a per-org URL, so on the hosted multi-tenant
  // platform it must beat the platform-wide DASHBOARD_ORIGIN — exactly the
  // precedence a verified customDomain gets above. Gated to self-owned
  // production so local dev (localhost below) and self-hosted single-host
  // installs (no routable `<siteName>.<root>` subdomains) are unaffected.
  if (isSelfOwnedDeployment && env.NODE_ENV === 'production' && org?.siteName) {
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
 * Returns the configured ClassroomHub admin dashboard origin.
 *
 * Use for **teacher/tutor/admin email links** — course management, grading,
 * team invites, auto-enroll, and any other staff dashboard action. Staff sign
 * in on the admin app, not the org public site.
 *
 * Do not use for student/learner-facing links; use `getDashboardBaseUrl(org)`.
 */
export function getAppBaseUrl(): string {
  return getDashboardBaseUrl();
}
