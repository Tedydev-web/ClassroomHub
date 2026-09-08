import { localeFromPath } from '$lib/i18n';
import type { Handle, RequestEvent } from '@sveltejs/kit';

const DOCS_ORIGIN = 'https://cio-docs.digdippa.workers.dev';
const HELP_ORIGIN = 'https://cio-help.digdippa.workers.dev';

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

  // The documentation and the Help Center are separate workers served under this
  // domain, so they are proxied rather than redirected: readers stay on
  // classroom.io.vn and the pages keep one origin for cookies and analytics.
  if (pathname === '/docs' || pathname.startsWith('/docs/')) {
    return proxy(DOCS_ORIGIN, pathname, event);
  }

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
