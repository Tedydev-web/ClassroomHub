/**
 * A translated string for a `load` function, resolved per call rather than from the store.
 *
 * `$t` is backed by a module-level singleton that holds one current locale. That is correct in
 * a component, where the module belongs to one browser tab, and wrong in a server `load`, where
 * the module is shared by every request the process is serving: two teachers on different
 * locales would race for the same variable and one of them would get the other's language.
 *
 * So this reads the dictionaries directly for the locale it is given, holds no state between
 * calls, and never returns the key itself — a title that prints `course.navItem.marks.title`
 * into a browser tab is worse than the platform default it replaced.
 */

type Dictionary = Record<string, unknown>;

const DICTIONARIES: Record<string, () => Promise<{ default: Dictionary }>> = {
  en: () => import('../translations/en.json'),
  hi: () => import('../translations/hi.json'),
  fr: () => import('../translations/fr.json'),
  pl: () => import('../translations/pl.json'),
  pt: () => import('../translations/pt.json'),
  de: () => import('../translations/de.json'),
  vi: () => import('../translations/vi.json'),
  ru: () => import('../translations/ru.json'),
  es: () => import('../translations/es.json'),
  da: () => import('../translations/da.json')
};

function readPath(dictionary: Dictionary, key: string): string | undefined {
  let current: unknown = dictionary;
  for (const segment of key.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Dictionary)[segment];
  }

  return typeof current === 'string' ? current : undefined;
}

async function loadDictionary(locale: string): Promise<Dictionary | null> {
  const loader = DICTIONARIES[locale];
  if (!loader) return null;

  try {
    return (await loader()).default;
  } catch {
    return null;
  }
}

/**
 * The document title for a screen, in the reader's locale.
 *
 * English stands in for a locale that has no wording of its own, mirroring the `fallbackLocale`
 * the component-side translator already uses: eight of the ten locales are missing whole
 * features, and a blank tab is not an improvement on an English one.
 *
 * Returns an empty string when the key exists in no dictionary, which callers pass through as
 * `undefined` so the page keeps the site's default title rather than showing nothing.
 */
export async function resolveDocumentTitle(locale: string | undefined | null, key: string): Promise<string> {
  const requested = locale ? await loadDictionary(locale) : null;
  const fromRequested = requested ? readPath(requested, key) : undefined;
  if (fromRequested) return fromRequested;

  const english = await loadDictionary('en');

  return (english ? readPath(english, key) : undefined) ?? '';
}

/** `pageMetaTags` for a screen whose title is a fixed section name. */
export async function sectionMetaTags(
  locale: string | undefined | null,
  key: string
): Promise<{ title: string } | undefined> {
  const title = await resolveDocumentTitle(locale, key);

  return title ? Object.freeze({ title }) : undefined;
}
