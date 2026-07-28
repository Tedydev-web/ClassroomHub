import type { Handle } from '@sveltejs/kit';

const CANONICAL_HOST = 'classroom.io.vn';
const WWW_HOST = `www.${CANONICAL_HOST}`;

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', "base-uri 'self'; frame-ancestors 'none'; object-src 'none'");
  headers.set('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Strict-Transport-Security', 'max-age=31536000');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');

  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export const handle: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url;

  if (event.url.hostname === WWW_HOST) {
    const canonicalUrl = new URL(event.url);
    canonicalUrl.hostname = CANONICAL_HOST;
    return withSecurityHeaders(Response.redirect(canonicalUrl.toString(), 301));
  }

  if (pathname === '/docs' || pathname.startsWith('/docs/')) {
    const docs = event.platform?.['env'].DOCS;
    if (!docs) return withSecurityHeaders(new Response('Documentation service unavailable', { status: 503 }));

    try {
      return withSecurityHeaders(await docs.fetch(event.request));
    } catch (error) {
      console.error('Documentation service binding request failed', error);
      return withSecurityHeaders(new Response('Documentation service unavailable', { status: 503 }));
    }
  }

  return withSecurityHeaders(await resolve(event));
};
