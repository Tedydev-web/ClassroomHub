import { PRODUCT_ROOT_DOMAIN } from '@cio/utils/constants';

import { MARKETING_PAGES } from '$lib/seo/marketing-pages';
import { DEFAULT_LOCALE, LOCALES, pathInLocale } from '$lib/i18n/locale';

export const prerender = true;

/**
 * Prerendering runs against the placeholder origin `http://sveltekit-prerender`,
 * so anything read from `event.url` bakes that string into the built file. A
 * sitemap of unreachable URLs is worse than no sitemap, so the origin is the
 * same constant the canonical tags use.
 */
const SITE_ORIGIN = `https://${PRODUCT_ROOT_DOMAIN}`;

function absolute(pathname: string): string {
  return new URL(pathname, SITE_ORIGIN).href;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * One `<url>` per page per locale, each listing every locale as an alternate.
 *
 * Google reads the alternates as a set and expects every member to point back at
 * the whole set, so the Vietnamese and English entries carry identical
 * `<xhtml:link>` blocks — including a self-reference. Listing only the other
 * language is the common mistake, and it makes the group unusable rather than
 * partially useful.
 */
function urlEntry(pathname: string): string {
  const alternates = [...LOCALES, 'x-default']
    .map((locale) => {
      const target = pathInLocale(pathname, locale === 'x-default' ? DEFAULT_LOCALE : (locale as 'vi' | 'en'));
      return `    <xhtml:link rel="alternate" hreflang="${locale}" href="${escapeXml(absolute(target))}"/>`;
    })
    .join('\n');

  return `  <url>\n    <loc>${escapeXml(absolute(pathname))}</loc>\n${alternates}\n  </url>`;
}

export function GET() {
  const entries = MARKETING_PAGES.flatMap((page) => LOCALES.map((locale) => urlEntry(pathInLocale(page, locale))));

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join('\n')}
</urlset>
`;

  return new Response(body, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600'
    }
  });
}
