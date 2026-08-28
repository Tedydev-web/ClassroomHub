import { describe, expect, it } from 'vitest';

import { config } from './translations';

/**
 * The exam feature shipped in English and Vietnamese only, and eight of the ten locales are
 * missing the same 366 keys. Without a fallback, `$t` returns the key path — so a candidate
 * who switched to French met `exam.sitting.submit` printed on the button they had to press.
 *
 * These assert the wiring rather than the library: that the fallback is configured, that it
 * points at the one locale which is complete, and that the locale it points at is actually
 * loadable. A fallback naming a locale with no loader would fail exactly when it is needed.
 */
describe('translation config', () => {
  it('falls back to English rather than printing key paths', () => {
    expect(config.fallbackLocale).toBe('en');
  });

  it('has a loader for the locale it falls back to', () => {
    const locales = config.loaders.map((loader) => loader.locale);

    expect(locales).toContain(config.fallbackLocale);
  });

  it('offers every locale the language picker lists', async () => {
    const { LANGUAGES } = await import('$lib/utils/constants/translation');
    const locales = new Set(config.loaders.map((loader) => loader.locale));

    // A picker row with no loader behind it is a language a person can select and never get.
    for (const language of LANGUAGES) {
      expect(locales.has(language.id)).toBe(true);
    }
  });
});
