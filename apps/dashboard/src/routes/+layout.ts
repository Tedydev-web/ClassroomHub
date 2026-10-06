import { config, ensureTranslations, getPersistedLocale } from '$lib/utils/functions/translations';

const SUPPORTED_LANGUAGES = config?.loaders?.map((loader) => loader.locale) || [];

export const load = async ({ data }) => {
  const serverLang = data?.serverLang?.split?.('-')?.[0] || 'en';
  const persistedLocale = data?.localeCookie || getPersistedLocale();

  const enforcedOrgLocale =
    data?.isOrgSite && data?.org?.settings?.language?.enforced ? data.org.settings.language.locale : undefined;
  const defaultOrgLocale = data?.isOrgSite ? data?.org?.settings?.language?.locale : undefined;
  const userLocale =
    enforcedOrgLocale ||
    persistedLocale ||
    data?.locals?.profile?.locale ||
    defaultOrgLocale ||
    getInitialLocale(serverLang);

  const initLocale = getInitialLocale(userLocale);
  await ensureTranslations(initLocale); // keep this just before the `return`

  return data ?? {};
};

function getInitialLocale(lang: string): string {
  const locale = lang.split('-')[0];

  if (SUPPORTED_LANGUAGES.includes(locale)) return locale;

  return 'en';
}
