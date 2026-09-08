import i18n from '@sveltekit-i18n/base';
import parser from '@sveltekit-i18n/parser-icu';

export { DEFAULT_LOCALE, LOCALES, LOCALE_COOKIE, localeFromPath, pathInLocale, type Locale } from './locale';

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
