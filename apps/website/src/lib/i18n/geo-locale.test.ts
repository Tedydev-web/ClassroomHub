import assert from 'node:assert/strict';
import test from 'node:test';

import { applyGeoLocale } from './geo-locale.ts';

/**
 * The rules that keep a guessed language from becoming a trap. Each one is a
 * failure a visitor would have to escape by hand, so each is checked here.
 */
function situation({ cookie = '', country = 'US', path = '/' } = {}) {
  const replaced: string[] = [];

  globalThis.document = { cookie } as Document;
  globalThis.window = {
    location: { search: '', replace: (url: string) => replaced.push(url) }
  } as unknown as Window & typeof globalThis;
  globalThis.fetch = (async () => ({
    ok: true,
    text: async () => `fl=14f20\nloc=${country}\ntls=TLSv1.3\n`
  })) as unknown as typeof fetch;

  return { replaced, run: () => applyGeoLocale(path) };
}

test('a visitor outside Vietnam is moved to English', async () => {
  const { replaced, run } = situation({ country: 'US' });
  await run();
  assert.deepEqual(replaced, ['/en']);
});

test('a visitor in Vietnam stays on the Vietnamese page', async () => {
  const { replaced, run } = situation({ country: 'VN' });
  await run();
  assert.deepEqual(replaced, []);
});

test('a chosen language is never guessed over', async () => {
  const { replaced, run } = situation({ country: 'US', cookie: 'classroomhub_locale=vi' });
  await run();
  assert.deepEqual(replaced, []);
});

test('a shared link deeper than the entry page opens the page it names', async () => {
  const { replaced, run } = situation({ country: 'US', path: '/pricing' });
  await run();
  assert.deepEqual(replaced, []);
});

test('an unknown country leaves the default', async () => {
  const { replaced, run } = situation({ country: 'XX' });
  await run();
  assert.deepEqual(replaced, []);
});

test('someone in Vietnam who opened /en is brought back', async () => {
  const { replaced, run } = situation({ country: 'VN', path: '/en' });
  await run();
  assert.deepEqual(replaced, ['/']);
});
