import { PRODUCT_URLS } from '@cio/utils/constants';
import { redirect } from '@sveltejs/kit';
import { client } from '$lib/utils/posthog';
import { getDistinctId } from '$lib/utils/posthog/distinct-id';

export const prerender = false;

// Upstream sends this path to its own feedback host. This deployment keeps the
// path — links to it exist — and answers it the way `/demo` and `/feedback` are
// answered here: with this product's own site, never another company's.
export const load = ({ request }) => {
  client.capture({
    distinctId: getDistinctId(request),
    event: 'changelog page visited'
  });

  redirect(307, PRODUCT_URLS.marketing);
};
