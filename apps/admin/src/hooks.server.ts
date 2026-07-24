import type { Handle } from '@sveltejs/kit';

const API_PREFIX = '/api';

/**
 * Forwards `/api/*` to the internal API. The admin app has no tenant routing and
 * is reached only over the private network, so this is a straight pass-through
 * that strips the `/api` prefix and preserves method, headers, and body —
 * including the operator's `X-Super-Admin-Key`.
 */
export const handle: Handle = async ({ event, resolve }) => {
  if (event.url.pathname.startsWith(API_PREFIX)) {
    const upstream = process.env.PRIVATE_SERVER_URL;
    if (!upstream) {
      return new Response('API not configured', { status: 502 });
    }

    const target = new URL(event.url.pathname.slice(API_PREFIX.length) + event.url.search, upstream);

    const headers = new Headers(event.request.headers);
    headers.set('host', target.host);

    const hasBody = event.request.method !== 'GET' && event.request.method !== 'HEAD';

    return fetch(target, {
      method: event.request.method,
      headers,
      body: hasBody ? event.request.body : undefined,
      // Streaming a request body requires half-duplex mode; undici needs it set.
      ...(hasBody ? { duplex: 'half' } : {})
    } as RequestInit);
  }

  return resolve(event);
};
