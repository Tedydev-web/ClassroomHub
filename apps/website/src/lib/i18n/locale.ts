/**
 * Where a locale lives in a URL, with no translation machinery attached.
 *
 * Kept apart from the catalogue so these rules can be read — and tested — without
 * loading the i18n library, which needs a browser-shaped environment.
 */
export const DEFAULT_LOCALE = 'vi';
export const LOCALES = ['vi', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * Where an explicit language choice is remembered.
 *
 * The dashboard stores its own under the same name, but this one is written with
 * no `Domain` and the two live on different hosts, so nothing travels between
 * them: this is the website's own memory, and only of a choice the visitor made.
 */
export const LOCALE_COOKIE = 'classroomhub_locale';

/** The locale a path is written in: `/en/...` is English, everything else Vietnamese. */
export function localeFromPath(pathname: string): Locale {
  return pathname === '/en' || pathname.startsWith('/en/') ? 'en' : DEFAULT_LOCALE;
}

/** The same page in the other locale, for the switcher and for `hreflang`. */
export function pathInLocale(pathname: string, target: Locale): string {
  const bare = pathname === '/en' ? '/' : pathname.startsWith('/en/') ? pathname.slice(3) : pathname;

  if (target === DEFAULT_LOCALE) return bare;

  return bare === '/' ? '/en' : `/en${bare}`;
}
