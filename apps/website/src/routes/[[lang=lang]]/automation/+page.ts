import { ensureTranslations, localeFromPath, t } from '$lib/i18n';
import { get } from 'svelte/store';

export const prerender = true;

export const load = async ({ url }) => {
  await ensureTranslations(localeFromPath(url.pathname));
  const translate = get(t);

  return {
    pageMetaTags: {
      title: translate('dev.meta_title'),
      description: translate('dev.meta_description')
    }
  };
};
