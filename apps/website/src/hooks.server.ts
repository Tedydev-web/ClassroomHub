import { localeFromPath } from '$lib/i18n';
import type { Handle } from '@sveltejs/kit';

/**
 * Stamp the document's language onto `<html lang>`.
 *
 * A screen reader picks its voice from this attribute, and a browser offers to
 * translate the page based on it, so a Vietnamese page served as `lang="en"` is
 * read aloud in the wrong accent and offered a translation it does not need.
 * The prerenderer runs this hook too, so both trees are stamped at build time.
 */
export const handle: Handle = async ({ event, resolve }) =>
  resolve(event, {
    transformPageChunk: ({ html }) => html.replace('%cio.lang%', localeFromPath(event.url.pathname))
  });
