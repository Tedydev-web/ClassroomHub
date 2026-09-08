import { DEFAULT_LOCALE, LOCALE_COOKIE, localeFromPath, pathInLocale, type Locale } from './locale.ts';

/**
 * Send a first-time visitor to the language their country reads.
 *
 * Both language trees are prerendered and served straight from Cloudflare's asset
 * store, which means no worker runs for them and there is no request-time hook to
 * decide from. `/cdn-cgi/trace` is the same edge's own answer about where the
 * request came from, so the country is Cloudflare's, not a guess from the browser.
 *
 * Three rules keep the guess from becoming a trap:
 *
 *   - it runs only on the two entry paths, never deeper in the site, so a shared
 *     link always opens the page it names;
 *   - an explicit choice wins and is never asked again, because the switcher
 *     writes the cookie this reads first — a Vietnamese speaker on a foreign VPN
 *     clicks VI once;
 *   - anything unknown (a failed request, `XX`, Tor's `T1`) leaves the default.
 *
 * `location.replace` rather than an assignment: the guessed page must not sit in
 * the back button between the visitor and the page they asked for.
 */
export async function applyGeoLocale(pathname: string): Promise<void> {
  if (pathname !== '/' && pathname !== '/en') return;
  if (readCookie(LOCALE_COOKIE)) return;

  const country = await edgeCountry();
  if (!country) return;

  const wanted: Locale = country === 'VN' ? DEFAULT_LOCALE : 'en';
  if (wanted === localeFromPath(pathname)) return;

  window.location.replace(pathInLocale(pathname, wanted) + window.location.search);
}

function readCookie(name: string): string | undefined {
  return document.cookie
    .split('; ')
    .find((pair) => pair.startsWith(`${name}=`))
    ?.split('=')[1];
}

async function edgeCountry(): Promise<string | null> {
  try {
    const response = await fetch('/cdn-cgi/trace', { headers: { accept: 'text/plain' } });
    if (!response.ok) return null;

    const country = /^loc=(\w+)$/m.exec(await response.text())?.[1];

    return !country || country === 'XX' || country === 'T1' ? null : country;
  } catch {
    // No trace endpoint (local development) or a blocked request: keep the default.
    return null;
  }
}
