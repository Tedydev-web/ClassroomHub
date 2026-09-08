/**
 * Written as one word on purpose. The name has to survive being a domain, a
 * package name, a container label and a social handle, and a two-word form
 * picks a different shape in each of those — `classroom-hub`, `classroomhub`,
 * `ClassroomHub` — giving four spellings to keep in sync instead of one.
 *
 * It also reads correctly: "ClassroomHub" parses as the hub belonging to some
 * product called ClassroomHub, when the hub is the product.
 */
export const PRODUCT_NAME = 'ClassroomHub';
export const PRODUCT_ROOT_DOMAIN = 'classroom.io.vn';

/**
 * Where learners reach a human. Used as the default `Reply-To` on every sent
 * email and printed in the body of the password-reset and welcome templates, so
 * it must be a mailbox somebody actually reads — not a `noreply` alias.
 *
 * Kept on the product domain deliberately: a "ClassroomHub" invite that replies to
 * a personal consumer address reads as phishing, and consumer providers cannot
 * DKIM-sign for this domain.
 */
export const OPERATOR_EMAIL = `support@${PRODUCT_ROOT_DOMAIN}`;

/**
 * Where demo and enterprise enquiries from the marketing site go.
 *
 * Deliberately the same mailbox as {@link OPERATOR_EMAIL} for now — the current
 * mail plan allows exactly one account. It is a separate constant so the two
 * audiences stay distinguishable at each call site: pointing this at a real
 * `sales@` later is a one-line change instead of an audit of every `mailto:`.
 */
export const SALES_EMAIL = OPERATOR_EMAIL;

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

/**
 * Every way a person can reach the people who run this deployment.
 *
 * One definition, because these end up in the marketing footer, the help
 * centre, transactional email and the dashboard's error pages, and a phone
 * number that is right in three of those and stale in the fourth is worse than
 * one that is missing everywhere.
 *
 * The phone number is stored in the national form people recognise and the
 * international form a `tel:` link needs: a Vietnamese reader looks for
 * `0869 685 621`, while a phone dialling from abroad needs `+84`.
 */
/**
 * The same hosts as absolute URLs, plus the two paths the marketing site proxies.
 *
 * Call sites had been writing these out by hand, and drifted: the website's
 * Dashboard button pointed at `classroom-app.tedydev.io.vn` while production is
 * configured with `hub.classroom.io.vn`, and the docs and Help Center links went
 * to a third hostname again. Both answer today, because they are aliases of the
 * same deployment, but a visitor saw a domain that is not the product's.
 *
 * Reading from here also makes moving the product to another domain a change to
 * {@link PRODUCT_ROOT_DOMAIN} and DNS, rather than a sweep of every literal.
 */
export const PRODUCT_URLS = {
  marketing: `https://${PRODUCT_HOSTS.marketing}`,
  dashboard: `https://${PRODUCT_HOSTS.dashboard}`,
  api: `https://${PRODUCT_HOSTS.api}`,
  play: `https://${PRODUCT_HOSTS.play}`,
  embed: `https://${PRODUCT_HOSTS.embed}`,
  assets: `https://${PRODUCT_HOSTS.assets}`,
  /** Served by their own workers, proxied under the marketing domain. */
  docs: `https://${PRODUCT_HOSTS.marketing}/docs`,
  help: `https://${PRODUCT_HOSTS.marketing}/help`
} as const;

export const CONTACT = {
  /** The mailbox on the product domain — also the account transactional mail is sent from. */
  email: OPERATOR_EMAIL,
  phoneDisplay: '0869 685 621',
  phoneDial: '+84869685621',
  zalo: 'https://zalo.me/0869685621',
  telegramHandle: '@ClassroomHub',
  telegram: 'https://t.me/ClassroomHub',
  facebook: 'https://facebook.com/ClassroomHub.io.vn'
} as const;
