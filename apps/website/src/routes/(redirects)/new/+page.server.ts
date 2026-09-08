import { PRODUCT_URLS } from '@cio/utils/constants';
import { dev } from '$app/environment';
import { redirect } from '@sveltejs/kit';

export const prerender = false;

export const load = async () => {
  const url = dev ? 'http://localhost:8000' : PRODUCT_URLS.dashboard;

  redirect(307, `${url}/org/*/courses?create=true`);
};
