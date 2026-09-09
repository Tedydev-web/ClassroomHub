import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { bucketForPublicAsset, hostSet } from './index';

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
    // The operator console is its own origin behind Cloudflare Access. Routed as a
    // tenant it would resolve to no organisation and answer 404 on every apex.
    assert.ok(
      hostSet(productionVar('DIRECT_PASSTHROUGH_HOSTS')).has(`admin.${apex}`),
      `admin.${apex} would be routed as a tenant instead of reaching the console`
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

/**
 * Regression: the public asset host serves user-uploaded images.
 *
 * The API publishes every avatar, organisation logo and course cover to the
 * `media` bucket at the root of this same hostname, while the build publishes
 * embed scripts and the marketing video to `assets` under two prefixes. Reading
 * only `assets` answered 404 for every uploaded image — a blank avatar in the
 * app and a broken logo in every email.
 */
test('an uploaded image is read from the media bucket, embeds from the assets bucket', () => {
  const env = { ASSETS_BUCKET: 'assets', MEDIA_BUCKET: 'media' } as unknown as Parameters<
    typeof bucketForPublicAsset
  >[1];

  assert.equal(bucketForPublicAsset('HzTAg5qSmhvR4qBiQbmO--cropped-image.png', env), 'media');
  assert.equal(bucketForPublicAsset('embeds/course-widget/course-widget.js', env), 'assets');
  assert.equal(bucketForPublicAsset('marketing/language-editor-demo.mov', env), 'assets');
});

/** Both buckets must be bound for production, or the Worker answers 500. */
test('production binds every bucket the public asset host reads', () => {
  const production = config.slice(config.indexOf('[env.production]'));

  for (const binding of ['ASSETS_BUCKET', 'MEDIA_BUCKET']) {
    assert.ok(
      new RegExp(`binding = "${binding}"`).test(production),
      `${binding} is not bound for production; bindings are not inherited from the top level`
    );
  }
});
