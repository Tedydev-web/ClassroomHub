/**
 * What is left of the developer documentation.
 *
 * The site is retired: it described self-hosting the platform and contributing to
 * its codebase, neither of which is offered. Setting `workers_dev: false` was not
 * enough on its own — the worker kept answering on its workers.dev address after
 * the setting was deployed and had propagated — so the worker no longer carries
 * the pages at all. It answers 410 instead, which tells a crawler the content is
 * gone rather than temporarily missing.
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
