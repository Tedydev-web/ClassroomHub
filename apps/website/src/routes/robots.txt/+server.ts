import { PRODUCT_ROOT_DOMAIN } from '@cio/utils/constants';

export const prerender = true;

/**
 * Served from a route rather than `static/` so the sitemap's absolute URL comes
 * from the same constant every canonical tag uses. A `robots.txt` naming a
 * sitemap on a domain the site has moved off is a file that points crawlers at
 * nothing, and a static copy is exactly the kind of literal a domain change
 * forgets.
 *
 * Everything published here is marketing copy, so nothing is disallowed. The
 * file this replaces had inherited a list of crawlers that have not existed for
 * a decade — Slurp, MSNBot, `yahoo-blogs/v3.9` — and a `/cgi-bin/` rule.
 */
export function GET() {
  const body = `User-agent: *
Disallow:

Sitemap: https://${PRODUCT_ROOT_DOMAIN}/sitemap.xml
`;

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600'
    }
  });
}
