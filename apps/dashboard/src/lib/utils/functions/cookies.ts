import type { Cookies } from '@sveltejs/kit';

/**
 * Returns the classroomhub cookie string for API/auth requests.
 * Filters cookies whose names include "classroomhub" and joins them as `name=value; ...`.
 */
export function getCioCookieString(cookies: Cookies): string {
  return cookies
    .getAll()
    .filter((c) => c.name.includes('classroomhub'))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

export function getHasCioCookies(cookies: Cookies): boolean {
  const cioCookies = cookies.getAll().filter((c) => c.name.includes('classroomhub'));

  if (cioCookies.length === 0) return false;

  // check if the cookies doesn't includ ONLY classroomhub_locale
  const onlyLocaleCookie = cioCookies.every((c) => c.name === 'classroomhub_locale');

  return !onlyLocaleCookie;
}

const ORG_ID_COOKIE_PREFIX = 'cio_org_id_';

/**
 * Browser-only fallback for the current org id, read from the `cio_org_id_<site>`
 * cookie the org layout sets (httpOnly:false for exactly this reason).
 *
 * The API client normally derives `cio-org-id` from the `currentOrg` store, but
 * that store can still be empty on first paint (e.g. the notifications call in
 * the header mounts before the layout hydrates the store), which makes the API
 * reject the request with ORG_ID_REQUIRED. Reading the cookie closes that race.
 *
 * Tenant subdomains are host-scoped, so exactly one such cookie exists there —
 * used directly. On the hub host several orgs may be cached; disambiguate by the
 * `/org/<slug>` path segment and never guess when it is absent.
 */
export function getClientOrgIdFromCookie(): string | undefined {
  if (typeof document === 'undefined' || typeof window === 'undefined') return undefined;

  const entries = document.cookie
    .split(';')
    .map((cookie) => cookie.trim())
    .filter((cookie) => cookie.startsWith(ORG_ID_COOKIE_PREFIX))
    .map((cookie) => {
      const eq = cookie.indexOf('=');
      return {
        site: cookie.slice(ORG_ID_COOKIE_PREFIX.length, eq),
        value: decodeURIComponent(cookie.slice(eq + 1))
      };
    })
    .filter((entry) => entry.site && entry.value);

  if (entries.length === 0) return undefined;
  if (entries.length === 1) return entries[0].value;

  const slug = window.location.pathname.match(/^\/org\/([^/]+)/)?.[1];
  return slug ? entries.find((entry) => entry.site === slug)?.value : undefined;
}
