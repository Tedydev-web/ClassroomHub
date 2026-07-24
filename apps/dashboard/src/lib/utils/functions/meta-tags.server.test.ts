import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/static/public', () => ({ PUBLIC_IS_SELFHOSTED: 'false' }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));

import { resolvePublicRequestUrl } from './metaTags.server';

describe('resolvePublicRequestUrl', () => {
  const upstreamUrl = new URL('http://dashboard-origin.example.test/course/demo?preview=true');

  it('uses the first valid forwarded host and protocol', () => {
    const headers = new Headers({
      'x-forwarded-host': 'classroom.example.test, dashboard-origin.example.test',
      'x-forwarded-proto': 'https, http'
    });

    expect(resolvePublicRequestUrl(upstreamUrl, headers).href).toBe(
      'https://classroom.example.test/course/demo?preview=true'
    );
  });

  it.each([
    new Headers(),
    new Headers({
      'x-forwarded-host': 'classroom.example.test',
      'x-forwarded-proto': 'javascript'
    }),
    new Headers({
      'x-forwarded-host': 'classroom.example.test/untrusted-path',
      'x-forwarded-proto': 'https'
    })
  ])('keeps the upstream URL when forwarded headers are missing or invalid', (headers) => {
    expect(resolvePublicRequestUrl(upstreamUrl, headers).href).toBe(upstreamUrl.href);
  });
});
