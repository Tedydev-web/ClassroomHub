/**
 * Every public marketing page, as the path it has in the default locale.
 *
 * Written out rather than discovered, because the sitemap is built into a
 * Cloudflare Worker where there is no filesystem to walk. `marketing-pages.test.ts`
 * compares this list against the route directories, so a page that ships without
 * being added here fails the test rather than quietly staying out of the sitemap.
 *
 * Route groups — the `(marketing)` directory — are not part of a URL, so they do
 * not appear here.
 */
export const MARKETING_PAGES: readonly string[] = [
  '/',
  '/automation',
  '/compliance-training',
  '/customer-education',
  '/customer-education/vs-help-docs',
  '/docs-vs-company-academy',
  '/mcp-recipes',
  '/partner-training',
  '/pricing',
  '/public-courses',
  '/teach'
];
