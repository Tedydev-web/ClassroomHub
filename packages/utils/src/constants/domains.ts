import { PRODUCT_HOSTS, PRODUCT_ROOT_DOMAIN } from './product-identity';

/**
 * The apex that hosts every free-tier tenant site as `<orgSiteName>.<TENANT_ROOT_DOMAIN>`.
 * The `apps/cio-tenant-router` Cloudflare Worker terminates traffic for this zone and forwards
 * to the dashboard service.
 *
 * Deliberately its own constant rather than an alias that must follow the brand.
 * A tenant hostname is printed on issued certificates, sits in links learners
 * already hold, and is stored against uploaded media — so when the brand moves
 * to a new apex, existing tenants stay where they were addressed and only new
 * ones follow. Point this at a literal, not at {@link BRAND_ROOT_DOMAIN}, on the
 * day the two diverge.
 */
export const TENANT_ROOT_DOMAIN = PRODUCT_ROOT_DOMAIN;

/** The marketing / admin / api zone. */
export const BRAND_ROOT_DOMAIN = PRODUCT_ROOT_DOMAIN;

/**
 * Apexes this deployment still answers on after the brand moved off them.
 *
 * A domain migration is not a switch: certificates carry verification URLs on
 * the old host, media rows store absolute URLs against it, and links that were
 * shared are not recallable. So the old apex keeps resolving, and every place
 * that *accepts* a hostname — CORS, trusted origins, tenant resolution, the
 * check that stops a customer claiming a platform domain as their own — must
 * accept the whole list. Only the places that *emit* a URL use the canonical
 * one, which is how visitors migrate without anything breaking underneath them.
 *
 * Empty while the brand has never moved. Adding the previous apex here is the
 * second half of changing {@link PRODUCT_ROOT_DOMAIN}; changing one without the
 * other is what breaks the old domain.
 */
export const LEGACY_ROOT_DOMAINS: readonly string[] = [];

/** Every apex this deployment owns — canonical first. */
export const ACCEPTED_ROOT_DOMAINS: readonly string[] = [
  ...new Set([BRAND_ROOT_DOMAIN, TENANT_ROOT_DOMAIN, ...LEGACY_ROOT_DOMAINS])
];

function normalizeHost(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^www\./, '');
}

/** True when the hostname is this platform's own — on any apex it answers on. */
export function isPlatformHost(hostname: string): boolean {
  const host = normalizeHost(hostname);

  return ACCEPTED_ROOT_DOMAINS.some((root) => host === root || host.endsWith(`.${root}`));
}

/**
 * The tenant's `siteName` when the hostname is `<siteName>.<an accepted apex>`,
 * otherwise null. Rejects deeper labels: `a.b.<root>` is a platform host, not a
 * tenant called `a.b`.
 */
export function getTenantSiteNameFromHost(hostname: string): string | null {
  const host = normalizeHost(hostname);

  for (const root of ACCEPTED_ROOT_DOMAINS) {
    const suffix = `.${root}`;
    if (!host.endsWith(suffix)) continue;

    const siteName = host.slice(0, -suffix.length);
    if (siteName && !siteName.includes('.')) return siteName;
  }

  return null;
}

export const DASHBOARD_HOST = PRODUCT_HOSTS.dashboard;
export const API_HOST = PRODUCT_HOSTS.api;
export const ASSET_HOST = PRODUCT_HOSTS.assets;

export { EMBED_PUBLIC_BASE_URL, EMBED_PUBLIC_HOST } from './embeds';
