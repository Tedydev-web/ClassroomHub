import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (locale: string) => JSON.parse(readFileSync(join(here, `${locale}.json`), 'utf8'));

function paths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];

  return Object.entries(value).flatMap(([key, child]) => paths(child, prefix ? `${prefix}.${key}` : key));
}

/**
 * The two catalogues must describe the same page.
 *
 * A key present in English and missing in Vietnamese does not fail anywhere: the
 * fallback quietly serves the English sentence, so a half-translated page looks
 * finished until a reader meets the one paragraph nobody translated.
 */
test('English and Vietnamese cover the same keys', () => {
  const en = new Set(paths(read('en')));
  const vi = new Set(paths(read('vi')));

  const untranslated = [...en].filter((key) => !vi.has(key));
  const orphaned = [...vi].filter((key) => !en.has(key));

  assert.deepEqual(untranslated, [], `keys with no Vietnamese: ${untranslated.length}`);
  assert.deepEqual(orphaned, [], `Vietnamese keys nothing reads: ${orphaned.length}`);
});
