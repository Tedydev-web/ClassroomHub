import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { MARKETING_PAGES } from './marketing-pages.ts';

const routesDir = join(dirname(fileURLToPath(import.meta.url)), '../../routes');

/**
 * The URL paths SvelteKit actually publishes, read from the route tree.
 *
 * `[[lang=lang]]` is the optional locale prefix and `(marketing)` is a route
 * group: neither contributes a segment to the URL, so both are dropped.
 */
function publishedPaths(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const child = join(dir, entry.name);

    if (readdirSync(child).includes('+page.svelte')) {
      const segments = relative(routesDir, child)
        .split('/')
        .filter((segment) => segment !== '[[lang=lang]]' && !segment.startsWith('('));

      acc.push(`/${segments.join('/')}`);
    }

    publishedPaths(child, acc);
  }

  return acc;
}

/**
 * Regression: a marketing page that ships without entering the sitemap.
 *
 * Nothing about that failure is visible — the page builds, serves and looks
 * finished; it is simply never offered to a crawler, and the only symptom is
 * traffic that never arrives. The route tree is the fact, so the list is checked
 * against it rather than against anyone's memory.
 */
test('the sitemap lists exactly the pages the site publishes', () => {
  assert.deepEqual([...MARKETING_PAGES].sort(), publishedPaths(routesDir).sort());
});
