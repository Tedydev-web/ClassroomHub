import type { AccountOrg } from '$features/app/types';

/** Same file the platform's own pages use, served from every origin the app answers on. */
const DEFAULT_FAVICON_PATH = '/logo-32.png';

export function getOrgFaviconHref(
  org: Pick<AccountOrg, 'favicon' | 'avatarUrl'> | null | undefined,
  pageOrigin?: string
): string | null {
  const favicon = org?.favicon?.trim();
  const avatarUrl = org?.avatarUrl?.trim();
  // An organisation that set neither still gets the platform's mark rather than
  // no icon at all: a tab with the browser's blank page glyph beside a branded
  // site reads as broken, and every organisation site is served from an origin
  // that carries this file.
  const rawHref = favicon || avatarUrl || DEFAULT_FAVICON_PATH;

  try {
    return new URL(rawHref, pageOrigin || undefined).href;
  } catch {
    return rawHref;
  }
}
