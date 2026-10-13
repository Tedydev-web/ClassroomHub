import type { TLocale } from '@cio/db/types';

export const LANGUAGE: Record<TLocale, string> = {
  da: 'Danish',
  de: 'German',
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  hi: 'Hindi',
  it: 'Italian',
  pl: 'Polish',
  pt: 'Portuguese',
  ru: 'Russian',
  tr: 'Turkish',
  vi: 'Vietnamese'
};

// Native names (endonyms) shown in the language switcher so each option
// reads in its own language, e.g. "Tiếng Việt" instead of "Vietnamese".
export const LANGUAGE_NATIVE: Record<TLocale, string> = {
  da: 'Dansk',
  de: 'Deutsch',
  en: 'English',
  es: 'Español',
  fr: 'Français',
  hi: 'हिन्दी',
  it: 'Italiano',
  pl: 'Polski',
  pt: 'Português',
  ru: 'Русский',
  tr: 'Türkçe',
  vi: 'Tiếng Việt'
};

export const LANGUAGES = Object.keys(LANGUAGE).map((lang) => ({
  id: lang,
  text: LANGUAGE[lang],
  native: LANGUAGE_NATIVE[lang]
}));
