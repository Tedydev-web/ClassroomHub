import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { absoluteImageUrl, imageMediaType, OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH, resolveMetaTags } from './metaTags';

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

/**
 * `og:image` must be absolute. The bundled default is written as a site-root path, and a
 * scraper reading the tag holds a string with no document to resolve it against — so the
 * card came back with its picture missing.
 */
describe('absoluteImageUrl', () => {
  const request = new URL('https://msna.classroom.io.vn/exam/abc123');

  it('resolves the bundled default against the site it is being served from', () => {
    expect(absoluteImageUrl('/classroomhub-opengraph.png', request)).toBe(
      'https://msna.classroom.io.vn/classroomhub-opengraph.png'
    );
  });

  it('resolves against the origin, never the page path', () => {
    // The exam page lives at /exam/<slug>; resolving relative to it would ask the scraper
    // for /exam/classroomhub-opengraph.png, which does not exist.
    expect(absoluteImageUrl('/classroomhub-opengraph.png', request)).not.toContain('/exam/');
  });

  it('leaves an address that is already absolute alone', () => {
    const cdn = 'https://cdn.example.com/og/course.png';

    expect(absoluteImageUrl(cdn, request)).toBe(cdn);
  });

  it('carries the origin of the site actually asked for, not a hardcoded one', () => {
    expect(absoluteImageUrl('/og.png', new URL('https://school.example.com/'))).toBe(
      'https://school.example.com/og.png'
    );
  });

  it('returns the original string when it cannot be resolved at all', () => {
    // Better a tag a tolerant scraper might still use than an exception during render.
    expect(absoluteImageUrl('', new URL('https://msna.classroom.io.vn/'))).toBe('https://msna.classroom.io.vn/');
  });
});

describe('imageMediaType', () => {
  it('reads the type off the address', () => {
    // The bundled default is a PNG that was being declared as JPEG and as WebP.
    expect(imageMediaType('https://msna.classroom.io.vn/classroomhub-opengraph.png')).toBe('image/png');
    expect(imageMediaType('/banner.JPG')).toBe('image/jpeg');
    expect(imageMediaType('/card.webp')).toBe('image/webp');
  });

  it('ignores a query string or fragment on the way to the extension', () => {
    expect(imageMediaType('https://cdn.example.com/og.png?v=2')).toBe('image/png');
    expect(imageMediaType('https://cdn.example.com/og.png#top')).toBe('image/png');
  });

  it('says nothing rather than guessing wrong', () => {
    // A missing tag costs a scraper nothing; a wrong one gives it grounds to drop the image.
    expect(imageMediaType('https://cdn.example.com/render/og')).toBeUndefined();
    expect(imageMediaType('')).toBeUndefined();
  });
});

describe('the card image tags describe the file that is actually served', () => {
  /** Width and height straight out of the PNG header, which is the only account that counts. */
  function pngSize(path: string) {
    const bytes = readFileSync(path);

    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }

  it('announces the dimensions the bundled image really has', () => {
    // These tags claimed 1920x1080 for a 1200x630 file. Scrapers lay a card out from the
    // numbers they are promised and check them against what they fetch, so being wrong here
    // ends with no picture and no error anywhere.
    const asset = fileURLToPath(new URL('../../../../static/classroomhub-opengraph.png', import.meta.url));

    expect(pngSize(asset)).toEqual({ width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT });
  });

  it('announces the media type the bundled image really is', () => {
    expect(imageMediaType('/classroomhub-opengraph.png')).toBe('image/png');
  });
});
