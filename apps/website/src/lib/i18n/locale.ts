/**
 * Where a locale lives in a URL, with no translation machinery attached.
 *
 * Kept apart from the catalogue so these rules can be read — and tested — without
 * loading the i18n library, which needs a browser-shaped environment.
 */
export const DEFAULT_LOCALE = 'vi';
export const LOCALES = ['vi', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** Shared with the dashboard, so a visitor who picks a language keeps it across both. */
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
