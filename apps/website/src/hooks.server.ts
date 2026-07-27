import type { Handle } from '@sveltejs/kit';

const CANONICAL_HOST = 'classroom.io.vn';
const WWW_HOST = `www.${CANONICAL_HOST}`;

export const handle: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url;

  if (event.url.hostname === WWW_HOST) {
    const canonicalUrl = new URL(event.url);
    canonicalUrl.hostname = CANONICAL_HOST;
    return Response.redirect(canonicalUrl.toString(), 301);
  }

  if (pathname === '/docs' || pathname.startsWith('/docs/')) {
    const docs = event.platform?.['env'].DOCS;
    if (!docs) return new Response('Documentation service unavailable', { status: 503 });

    try {
      return await docs.fetch(event.request);
    } catch (error) {
      console.error('Documentation service binding request failed', error);
      return new Response('Documentation service unavailable', { status: 503 });
    }
  }

  return resolve(event);
};
