import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(svelte|ts|md|mdx)$/.test(entry) ? [path] : [];
  });
}

/**
 * The developer documentation is retired.
 *
 * It described self-hosting and contributing to the codebase, which is neither
 * offered nor accurate any more, and it was reachable in two ways: proxied at
 * /docs by this site, and directly on the worker's own preview subdomain. Both
 * had to close, so both are asserted here — a check on only the proxy would
 * have passed while every page stayed readable.
 */
test('nothing on the site or in the Help Center links to the retired documentation', () => {
  // The Help Center is scanned too: its navigation carried Developers and API
  // tabs pointing at /docs, and a check limited to this app never saw them.
  const offenders = [
    ...sourceFiles(join(appRoot, 'src')),
    join(appRoot, '../help/blume.config.ts'),
    ...sourceFiles(join(appRoot, '../help/content'))
  ]
    // hooks.server.ts names the path in order to close it; the next test covers that.
    .filter((path) => !path.endsWith('retired-docs.test.ts') && !path.endsWith('hooks.server.ts'))
    // Any /docs path, however it is written. An earlier form of this check
    // required a quote immediately before the slash, so an absolute URL —
    // 'https://classroom.io.vn/docs/api' — slipped past it, which is exactly how
    // the Help Center's Developers and API tabs survived. It is anchored to this
    // product's own host so a link into another project's documentation — the
    // SvelteKit reference in app.d.ts — is not mistaken for one of ours, and
    // `/docs-vs-…`, a marketing page, does not match either.
    .filter((path) =>
      /PRODUCT_URLS\.docs|classroom\.io\.vn\/docs|["'`(]\/docs(\/|["'`)]|$)/m.test(readFileSync(path, 'utf8'))
    );

  assert.deepEqual(offenders, [], `these still point at /docs: ${offenders.join(', ')}`);
});

test('/docs is answered with 410, not left to the marketing 404', () => {
  const hooks = readFileSync(join(appRoot, 'src/hooks.server.ts'), 'utf8');

  assert.match(hooks, /pathname\.startsWith\('\/docs\/'\)/);
  assert.match(hooks, /status: 410/);
  assert.doesNotMatch(hooks, /cio-docs/, 'the docs worker must no longer be proxied');
});

test('the docs worker carries a 410 handler instead of the pages', () => {
  const config = readFileSync(join(appRoot, '../docs/wrangler.jsonc'), 'utf8');

  // Disabling the workers.dev route was tried and left the pages up: with no
  // route the worker had no deploy target, so the new version was uploaded and
  // never promoted. Having no assets is what removes them, and the route has to
  // stay for that to reach the edge at all.
  assert.match(config, /"workers_dev":\s*true/);
  assert.match(config, /"main":\s*"src\/gone\.ts"/);
  assert.doesNotMatch(config, /"assets"/, 'the docs worker must not serve the retired pages');

  assert.match(readFileSync(join(appRoot, '../docs/src/gone.ts'), 'utf8'), /status: 410/);
});
