import { PRODUCT_HOSTS, PRODUCT_ROOT_DOMAIN } from './product-identity';

/**
 * The apex that hosts every free-tier tenant site as `<orgSiteName>.<TENANT_ROOT_DOMAIN>`.
 * The `apps/cio-tenant-router` Cloudflare Worker terminates traffic for this zone and forwards
 * to the dashboard service.
 */
export const TENANT_ROOT_DOMAIN = PRODUCT_ROOT_DOMAIN;

/** The marketing / admin / api zone. */
export const BRAND_ROOT_DOMAIN = PRODUCT_ROOT_DOMAIN;
export const DASHBOARD_HOST = PRODUCT_HOSTS.dashboard;
export const API_HOST = PRODUCT_HOSTS.api;
export const ASSET_HOST = PRODUCT_HOSTS.assets;

export { EMBED_PUBLIC_BASE_URL, EMBED_PUBLIC_HOST } from './embeds';
