import { localeFromPath } from '$lib/i18n';
import type { Handle, RequestEvent } from '@sveltejs/kit';

/**
 * This deployment's own Help Center worker.
 *
 * It used to point at `cio-help.digdippa.workers.dev`, which is not this
 * account: `digdippa` is the upstream project's workers.dev subdomain, and this
 * account's is `tedy-dev`. So every Help Center release CI has ever published
 * went to an address nothing read, while /help served the upstream project's
 * pages — titled "ClassroomIO Help Center", canonical link to classroomio.com.
 */
const HELP_ORIGIN = 'https://cio-help.tedy-dev.workers.dev';

function proxy(origin: string, pathname: string, event: RequestEvent) {
  const upstream = new URL(pathname + event.url.search, origin);

  const headers = new Headers(event.request.headers);
  headers.delete('host');
  headers.set('x-forwarded-host', event.url.host);
  headers.set('x-forwarded-proto', 'https');

  const hasBody = event.request.method !== 'GET' && event.request.method !== 'HEAD';

  return fetch(upstream, {
    method: event.request.method,
    headers,
    body: hasBody ? event.request.body : undefined,
    redirect: 'manual'
  });
}

export const handle: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url;

  // The developer documentation is retired. It is answered with 410 rather than
  // left to fall through to the marketing 404, because a crawler treats 410 as
  // "this is gone, drop it" and a soft 404 as "try again later" — and these
  // pages were indexable.
  if (pathname === '/docs' || pathname.startsWith('/docs/')) {
    return new Response('Gone', {
      status: 410,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'x-robots-tag': 'noindex' }
    });
  }

  // The Help Center is a separate worker served under this domain, so it is
  // proxied rather than redirected: readers stay on the product domain and the
  // pages keep one origin for cookies and analytics.
  if (pathname === '/help' || pathname.startsWith('/help/')) {
    return proxy(HELP_ORIGIN, pathname, event);
  }

  return resolve(event, {
    // A screen reader picks its voice from `<html lang>`, and a browser offers to
    // translate the page based on it, so it has to be the language actually
    // written. The prerenderer runs this hook too, so both trees are stamped at
    // build time.
    transformPageChunk: ({ html }) => html.replace('%cio.lang%', localeFromPath(pathname))
  });
};
