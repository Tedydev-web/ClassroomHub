import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { hostSet } from './index';

const config = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../wrangler.toml'), 'utf8');

/** The value of a `KEY = "…"` line inside the production vars block. */
function productionVar(name: string): string {
  const match = config.match(new RegExp(`^${name} = "([^"]*)"`, 'm'));
  assert.ok(match, `${name} is not set for production`);
  return match[1];
}

test('a host list is parsed into trimmed, lowercased hosts', () => {
  assert.deepEqual(
    [...hostSet('a.example.com, B.example.com ,, c.example.com')],
    ['a.example.com', 'b.example.com', 'c.example.com']
  );
  assert.equal(hostSet(undefined).size, 0);
  assert.equal(hostSet('  ').size, 0);
});

/**
 * Every apex the Worker has a route for must also be named in each host list.
 *
 * Adding a zone's route is one edit and updating five host lists is another, and
 * the second is easy to forget — the site comes up, the apex serves, and only
 * `assets.<new apex>` quietly falls through to tenant routing, which answers 404
 * for every image on the page. This fails instead.
 */
test('every routed apex appears in every host list', () => {
  const apexes = [...config.matchAll(/zone_name = "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(apexes.length > 0, 'the production environment should route at least one zone');

  const lists = {
    ASSET_HOST: 'assets',
    EMBED_HOST: 'embed',
    APEX_REDIRECT_HOST: 'learn'
  } as const;

  for (const apex of new Set(apexes)) {
    for (const [name, label] of Object.entries(lists)) {
      assert.ok(
        hostSet(productionVar(name)).has(`${label}.${apex}`),
        `${name} does not name ${label}.${apex}, but the Worker serves that zone`
      );
    }

    assert.ok(
      hostSet(productionVar('DIRECT_PASSTHROUGH_HOSTS')).has(`api.${apex}`),
      `api.${apex} would be routed as a tenant instead of reaching the API`
    );
    assert.ok(
      hostSet(productionVar('MARKETING_HOSTS')).has(apex),
      `${apex} would be routed as a tenant instead of serving the marketing site`
    );
  }
});

test('the canonical marketing host is one of the marketing hosts', () => {
  // Otherwise every marketing host redirects to a host that is not routed here.
  assert.ok(hostSet(productionVar('MARKETING_HOSTS')).has(productionVar('MARKETING_CANONICAL_HOST')));
});
