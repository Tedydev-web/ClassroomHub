export const PRODUCT_NAME = 'Classroom';
export const OPERATOR_EMAIL = 'hieudat2310.bh@gmail.com';
export const PRODUCT_ROOT_DOMAIN = 'classroom.io.vn';

/**
 * Platform hosts and tenant sites share one label level under the root domain:
 * `hub.classroom.io.vn` is the dashboard, `<orgSiteName>.classroom.io.vn` is a
 * tenant site. Keeping tenants one level deep means the zone's Universal SSL
 * wildcard already covers them, so no per-hostname certificate is needed.
 *
 * The trade-off is a shared namespace: every host named here must also appear in
 * `blockedSubdomain`, or an organisation could register a site name that shadows
 * the platform.
 */
export const PRODUCT_HOSTS = {
  marketing: PRODUCT_ROOT_DOMAIN,
  dashboard: 'hub.classroom.io.vn',
  api: 'api.classroom.io.vn',
  play: 'play.classroom.io.vn',
  embed: 'embed.classroom.io.vn',
  assets: 'assets.classroom.io.vn'
} as const;
