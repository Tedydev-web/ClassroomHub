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
