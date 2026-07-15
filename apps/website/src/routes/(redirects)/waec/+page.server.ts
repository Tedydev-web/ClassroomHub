import { redirect } from '@sveltejs/kit';

export const prerender = false;

export const load = async () => {
  redirect(307, 'https://classroom.tedydev.io.vn/f/1v25DtmN');
};
