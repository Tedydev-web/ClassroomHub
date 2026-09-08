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
    return /\.(svelte|ts|md)$/.test(entry) ? [path] : [];
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
test('nothing on the site links to the retired documentation', () => {
  const offenders = sourceFiles(join(appRoot, 'src'))
    // hooks.server.ts names the path in order to close it; the next test covers that.
    .filter((path) => !path.endsWith('retired-docs.test.ts') && !path.endsWith('hooks.server.ts'))
    .filter((path) => /PRODUCT_URLS\.docs|["'`(]\/docs\//.test(readFileSync(path, 'utf8')));

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

  // `workers_dev: false` alone did not close the address: an hour after it was
  // deployed the worker was still serving pages there. What actually removed
  // them is having no assets to serve.
  assert.match(config, /"workers_dev":\s*false/);
  assert.match(config, /"main":\s*"src\/gone\.ts"/);
  assert.doesNotMatch(config, /"assets"/, 'the docs worker must not serve the retired pages');

  assert.match(readFileSync(join(appRoot, '../docs/src/gone.ts'), 'utf8'), /status: 410/);
});
