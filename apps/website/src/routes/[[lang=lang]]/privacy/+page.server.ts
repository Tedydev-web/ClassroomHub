import { ensureTranslations, localeFromPath, t } from '$lib/i18n';
import { client } from '$lib/utils/posthog';
import { get } from 'svelte/store';

export const prerender = false;

export const load = async ({ request, url }) => {
  await ensureTranslations(localeFromPath(url.pathname));
  const translate = get(t);

  client.capture({
    distinctId: request.headers.get('x-forwarded-for') || new Date().getTime().toString(),
    event: 'privacy policy page visited'
  });

  return {
    pageMetaTags: {
      title: translate('legal.privacy_meta_title'),
      description: translate('legal.privacy_meta_description')
    }
  };
};
