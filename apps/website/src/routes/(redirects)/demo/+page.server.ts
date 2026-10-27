import { PRODUCT_URLS } from '@cio/utils/constants';
import { trackAndRedirect } from '$lib/utils/posthog/track-redirect';

export const prerender = false;

export const load = ({ request, platform }) =>
  trackAndRedirect({ request, platform }, 'cal.com page visited', PRODUCT_URLS.marketing);
