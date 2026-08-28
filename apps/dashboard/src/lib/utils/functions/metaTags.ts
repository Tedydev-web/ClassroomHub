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
  return merge({}, base, page ?? {});
}
