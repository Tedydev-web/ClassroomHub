import { PRODUCT_URLS } from '@cio/utils/constants';
import { redirect } from '@sveltejs/kit';

export const prerender = false;

export const load = () => {
  redirect(307, `${PRODUCT_URLS.marketing}/roadmap`);
};
