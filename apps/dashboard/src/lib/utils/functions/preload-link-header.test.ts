import { describe, expect, it } from 'vitest';

import { capPreloadLinkHeader, MAX_PRELOAD_LINK_HEADER_BYTES } from './preload-link-header';

function linkHeaderOf(entries: number): string {
  return Array.from(
    { length: entries },
    (_, index) => `</_app/immutable/chunks/${'x'.repeat(60)}${index}.js>; rel="modulepreload"; nopush`
  ).join(', ');
}

describe('preload link header', () => {
  it('leaves a header a client will actually read', () => {
    const response = new Response(null, { headers: { link: linkHeaderOf(10) } });
    const before = response.headers.get('link');

    capPreloadLinkHeader(response);

    expect(response.headers.get('link')).toBe(before);
  });

  it('trims a header past the size most preview fetchers refuse', () => {
    const response = new Response(null, { headers: { link: linkHeaderOf(400) } });

    capPreloadLinkHeader(response);

    const trimmed = response.headers.get('link') ?? '';
    expect(trimmed.length).toBeGreaterThan(0);
    expect(trimmed.length).toBeLessThanOrEqual(MAX_PRELOAD_LINK_HEADER_BYTES);
    expect(trimmed.endsWith('nopush')).toBe(true);
  });

  it('drops a header whose first entry alone is too large to keep', () => {
    const response = new Response(null, {
      headers: { link: `<${'a'.repeat(MAX_PRELOAD_LINK_HEADER_BYTES)}>; rel="modulepreload"` }
    });

    capPreloadLinkHeader(response);

    expect(response.headers.get('link')).toBeNull();
  });
});
