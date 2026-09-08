import i18n from '@sveltekit-i18n/base';
import parser from '@sveltekit-i18n/parser-icu';

export const DEFAULT_LOCALE = 'vi';
export const LOCALES = ['vi', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** Shared with the dashboard, so a visitor who picks a language keeps it across both. */
export const LOCALE_COOKIE = 'classroomhub_locale';

export const config = {
  parser: parser(),
  /** English fills any key a locale has not reached yet, rather than printing the key path. */
  fallbackLocale: 'en',
  loaders: [
    {
      locale: 'vi',
      key: '',
      loader: async () => (await import('./vi.json')).default
    },
    {
      locale: 'en',
      key: '',
      loader: async () => (await import('./en.json')).default
    }
  ]
};

export const { t, loading, locales, locale, translations, loadTranslations } = new i18n(config);

/*
  `@sveltekit-i18n/base` keeps its loading state in a process-global singleton, so two
  concurrent server renders can leave one awaiting a promise the other has purged. The
  dashboard hit exactly that; dedupe by locale so racing renders share one promise.
*/
const localeLoads = new Map<string, Promise<unknown>>();

/** Load a locale once per process, then activate it for this render. */
export async function ensureTranslations(target: string): Promise<void> {
  let load = localeLoads.get(target);

  if (!load) {
    load = Promise.resolve(loadTranslations(target)).catch((error) => {
      localeLoads.delete(target);
      throw error;
    });
    localeLoads.set(target, load);
  }

  await load;
  locale.forceSet(target);
}

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
