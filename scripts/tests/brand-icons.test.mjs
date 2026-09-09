import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const SOURCE_SVG = 'apps/dashboard/static/logo.svg';

/**
 * Directories that ship the product mark. Kept in step with the list in
 * `scripts/generate-brand-icons.mjs`, which writes them.
 */
const ICON_DIRS = [
  'apps/dashboard/static',
  'apps/website/static',
  'apps/course-app/static',
  'apps/admin/static',
  'apps/help/public',
  'packages/course-app/src/template/static'
];

const ICON_NAMES = ['logo.svg', 'logo-16.png', 'logo-32.png', 'logo-192.png', 'logo-512.png', 'favicon.ico'];

async function digest(path) {
  const bytes = await readFile(path).catch(() => null);

  return bytes ? createHash('sha256').update(bytes).digest('hex') : null;
}

/**
 * Every app draws the same mark.
 *
 * Three ways of drifting had all happened at once: the flat `#2563FF` variant
 * survived in `favicon.ico` and `logo-32.png` long after the gradient one became
 * the product mark, and the Help Center still shipped the upstream project's
 * logo entirely — a different shape, in a different blue, on a public page.
 *
 * Compares bytes rather than rendering anything, so it needs no image toolchain:
 * `scripts/generate-brand-icons.mjs` writes one render to every directory, and
 * anything that edits one copy alone fails here.
 */
test('every app ships the same mark', async () => {
  for (const name of ICON_NAMES) {
    const digests = new Map();

    for (const dir of ICON_DIRS) {
      const hash = await digest(join(dir, name));
      // A directory that does not ship this size is not a failure; the ones that
      // do have to agree.
      if (hash) digests.set(dir, hash);
    }

    const distinct = new Set(digests.values());
    assert.equal(
      distinct.size <= 1,
      true,
      `${name} differs between apps — run scripts/generate-brand-icons.mjs\n${[...digests]
        .map(([dir, hash]) => `  ${hash.slice(0, 12)}  ${dir}/${name}`)
        .join('\n')}`
    );
  }
});

/** The SVG copies are the source itself, so a redraw cannot leave a stale one behind. */
test('the SVG copies are the source', async () => {
  const source = await digest(SOURCE_SVG);
  assert.ok(source, `${SOURCE_SVG} is missing`);

  for (const dir of ICON_DIRS) {
    for (const name of ['logo.svg', 'logo-16.svg', 'logo-32.svg', 'logo-192.svg', 'logo-512.svg']) {
      const hash = await digest(join(dir, name));
      if (!hash) continue;

      assert.equal(hash, source, `${dir}/${name} is not ${SOURCE_SVG} — run scripts/generate-brand-icons.mjs`);
    }
  }
});
