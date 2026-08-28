import { describe, expect, it } from 'vitest';

import { resolveMetaTags } from './metaTags';

/** The shape `getBaseMetaTags` actually returns: frozen at the top, plain objects inside. */
function siteDefaults() {
  return Object.freeze({
    title: 'ClassroomHub',
    description: 'Marketing copy',
    robots: 'index,follow',
    openGraph: { title: 'ClassroomHub', description: 'Marketing copy', siteName: 'ClassroomHub' }
  });
}

describe('resolveMetaTags', () => {
  it('lets a page override the frozen site defaults', () => {
    const resolved = resolveMetaTags(siteDefaults(), {
      title: 'TEST 1 · K12',
      description: 'Mở 00:00 28/08/2026',
      robots: 'noindex, nofollow'
    });

    // The bug this test exists for: every one of these silently kept the site default,
    // because lodash cannot assign onto a frozen object and does not say so.
    expect(resolved.title).toBe('TEST 1 · K12');
    expect(resolved.description).toBe('Mở 00:00 28/08/2026');
    expect(resolved.robots).toBe('noindex, nofollow');
  });

  it('keeps the defaults the page says nothing about', () => {
    const resolved = resolveMetaTags(siteDefaults(), { title: 'TEST 1 · K12' });

    expect(resolved.robots).toBe('index,follow');
    expect(resolved.openGraph?.siteName).toBe('ClassroomHub');
  });

  it('overrides nested tags without dropping their siblings', () => {
    const resolved = resolveMetaTags(siteDefaults(), {
      openGraph: { title: 'TEST 1 · K12' }
    });

    expect(resolved.openGraph?.title).toBe('TEST 1 · K12');
    expect(resolved.openGraph?.description).toBe('Marketing copy');
  });

  it('leaves the site defaults untouched, so one request cannot colour the next', () => {
    const base = siteDefaults();
    resolveMetaTags(base, { title: 'TEST 1 · K12', openGraph: { title: 'TEST 1 · K12' } });

    expect(base.title).toBe('ClassroomHub');
    expect(base.openGraph.title).toBe('ClassroomHub');
  });

  it('falls back rather than blanking when a page has nothing to say', () => {
    // A course with no description passes null, and lodash treats null as a value worth
    // copying. Left alone it would erase the default for exactly the pages with the least.
    const resolved = resolveMetaTags(siteDefaults(), {
      title: 'Khoá K12',
      description: null as unknown as string,
      openGraph: { title: 'Khoá K12', description: null as unknown as string }
    });

    expect(resolved.title).toBe('Khoá K12');
    expect(resolved.description).toBe('Marketing copy');
    expect(resolved.openGraph?.description).toBe('Marketing copy');
  });

  it('lets a page blank a tag on purpose with an empty string', () => {
    expect(resolveMetaTags(siteDefaults(), { description: '' }).description).toBe('');
  });

  it('survives a page that sets nothing at all', () => {
    expect(resolveMetaTags(siteDefaults(), undefined).title).toBe('ClassroomHub');
  });
});
