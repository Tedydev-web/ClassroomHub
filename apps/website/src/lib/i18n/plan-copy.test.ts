import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { FEATURE_KEYS } from './plan-copy.ts';

const here = dirname(fileURLToPath(import.meta.url));
const plans = readFileSync(join(here, '../../../../../packages/utils/src/plans/data.ts'), 'utf8');
const catalogue = (locale: string) => JSON.parse(readFileSync(join(here, `${locale}.json`), 'utf8'));

/** The strings `PLANS` actually ships, read from the package rather than restated here. */
function shippedFeatures(): string[] {
  return [...plans.matchAll(/^\s{6}(?:'([^']+)'|`([^`]+)`),?$/gm)]
    .map(([, quoted, templated]) => quoted ?? templated?.replace('${PRODUCT_NAME}', 'ClassroomHub'))
    .filter((value): value is string => Boolean(value));
}

test('every plan feature the package ships has a translation key', () => {
  for (const feature of shippedFeatures()) {
    assert.ok(FEATURE_KEYS[feature], `no key for the plan feature ${JSON.stringify(feature)}`);
  }
});

test('every key resolves in both languages', () => {
  const en = catalogue('en').pricing.features;
  const vi = catalogue('vi').pricing.features;

  for (const key of Object.values(FEATURE_KEYS)) {
    assert.ok(en[key], `pricing.features.${key} is missing from English`);
    assert.ok(vi[key], `pricing.features.${key} is missing from Vietnamese`);
  }
});
