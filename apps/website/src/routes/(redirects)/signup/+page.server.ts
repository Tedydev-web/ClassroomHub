import { PRODUCT_URLS } from '@cio/utils/constants';
import { client } from '$lib/utils/posthog';
import { redirect } from '@sveltejs/kit';

export const prerender = false;

export const load = ({ request, url }) => {
  client.capture({
    distinctId: request.headers.get('x-forwarded-for') || new Date().getTime().toString(),
    event: 'signup'
  });

  redirect(307, `${PRODUCT_URLS.dashboard}/signup${url.search ?? ''}`);
};
