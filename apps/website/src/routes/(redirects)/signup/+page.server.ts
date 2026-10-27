import { PRODUCT_URLS } from '@cio/utils/constants';
import { trackAndRedirect } from '$lib/utils/posthog/track-redirect';

export const prerender = false;

export const load = ({ request, url, platform }) =>
  trackAndRedirect({ request, platform }, 'signup', `${PRODUCT_URLS.dashboard}/signup${url.search}`);
