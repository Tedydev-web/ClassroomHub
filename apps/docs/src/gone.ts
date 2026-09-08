/**
 * What is left of the developer documentation.
 *
 * The site is retired: it described self-hosting the platform and contributing to
 * its codebase, neither of which is offered. The worker no longer carries the
 * pages at all; it answers 410 instead, which tells a crawler the content is gone
 * rather than temporarily missing.
 *
 * Turning the workers.dev route off was tried first and did nothing: without a
 * route the worker had no deploy target, so wrangler uploaded each new version
 * and promoted none of them, and the old build kept serving. The route is what
 * lets this handler reach the edge.
 *
 * A stub rather than a deletion: removing the worker is the operator's call, and
 * this already leaves nothing to read.
 */
export default {
  fetch(): Response {
    return new Response('Gone', {
      status: 410,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'x-robots-tag': 'noindex' }
    });
  }
} satisfies ExportedHandler;
