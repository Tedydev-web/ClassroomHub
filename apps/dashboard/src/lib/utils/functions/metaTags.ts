import merge from 'lodash/merge';
import type { MetaTagsProps } from 'svelte-meta-tags';

/**
 * The page's own meta tags laid over the site's defaults.
 *
 * This exists as a named function with a test because the obvious inline spelling —
 * `merge(base, page)` — was silently wrong for months. `getBaseMetaTags` returns an
 * `Object.freeze`d object, lodash is sloppy-mode CommonJS, and assigning to a frozen
 * property in sloppy mode fails without throwing. Every top-level override was dropped on
 * the server while the nested `openGraph` object — which is not frozen — took its
 * overrides normally.
 *
 * The visible result was a page serving its own `og:title` to a chat app while serving the
 * platform's marketing title in `<title>`, and an exam page whose `noindex` never once
 * reached a crawler even though the loader had asked for it since the day it shipped.
 *
 * Merging into a fresh object fixes both, and stops the site defaults being mutated as a
 * side effect of reading them.
 */
export function resolveMetaTags(base: MetaTagsProps, page: MetaTagsProps | undefined | null): MetaTagsProps {
  return merge({}, base, withoutEmptyValues(page ?? {}));
}

/**
 * Drops the keys a page has nothing to say about, so they fall back instead of blanking.
 *
 * A loader builds its tags from whatever the record holds, and plenty of records hold
 * nothing: a course with no description passes `description: null`. lodash treats `null` as
 * a value worth copying and `undefined` as an absence, so leaving the nulls in would have
 * this function silently erase the site defaults for exactly the pages with the least to
 * say — which is the same shape of quiet wrongness it was written to end.
 *
 * Overriding means replacing what a page has, never what it lacks.
 */
function withoutEmptyValues<T>(tags: T): T {
  if (Array.isArray(tags) || tags === null || typeof tags !== 'object') return tags;

  const kept: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(tags)) {
    if (value === null || value === undefined) continue;

    kept[key] = withoutEmptyValues(value);
  }

  return kept as T;
}

/**
 * An image address a scraper can actually fetch.
 *
 * `og:image` is required to be absolute, and the bundled default is written as a site-root
 * path. A scraper reading the tag has no page to resolve that against — it holds a string,
 * not a document — so the tolerant ones guessed and the strict ones showed no image at all.
 *
 * It also silently emptied `og:image:secure_url`, which is only set when the address already
 * begins with `https://`; a root-relative path never does, so the tag was omitted from every
 * page using the default image.
 */
export function absoluteImageUrl(imageUrl: string, requestUrl: URL): string {
  try {
    return new URL(imageUrl, requestUrl.origin).href;
  } catch {
    // Not a resolvable address at all. Better the original string than nothing.
    return imageUrl;
  }
}

/**
 * The media type of the image being pointed at, read off its address.
 *
 * The default card declared the same PNG twice, once as `image/jpeg` and once as
 * `image/webp`. Neither was true, and the pair was not offering a scraper a choice of
 * formats either — both entries carried the identical URL. A scraper that checks the type it
 * was promised against the bytes it receives has grounds to discard the image on both.
 *
 * Unknown extensions get no type at all, which is a tag left out rather than a wrong answer.
 */
export function imageMediaType(imageUrl: string): string | undefined {
  const extension = imageUrl.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase();

  switch (extension) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'svg':
      return 'image/svg+xml';
    default:
      return undefined;
  }
}
