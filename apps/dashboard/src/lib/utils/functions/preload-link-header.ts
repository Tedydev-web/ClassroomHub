/**
 * How much of the preload header a page may carry.
 *
 * SvelteKit lists every module a route will need in one `Link` header, and the list grows
 * with the application. On the exam pages it reached twelve kilobytes, which put the whole
 * response header block past sixteen — the default ceiling in Node's HTTP parser and in most
 * of the fetchers that draw a link preview. Browsers read far larger headers, so the pages
 * opened normally for candidates while every link scraper reported the site as unreachable
 * and a shared paper previewed as a bare URL.
 *
 * Trimming rather than dropping: the entries that fit still preload, and a list a client will
 * read is worth more than a complete one it refuses.
 */
export const MAX_PRELOAD_LINK_HEADER_BYTES = 8_000;

export function capPreloadLinkHeader(response: Response): void {
  const link = response.headers.get('link');
  if (!link || link.length <= MAX_PRELOAD_LINK_HEADER_BYTES) return;

  const kept: string[] = [];
  let used = 0;

  // Whole entries only. Half a preload is a request for a file that is not there.
  for (const entry of link.split(', ')) {
    const cost = entry.length + (kept.length > 0 ? 2 : 0);
    if (used + cost > MAX_PRELOAD_LINK_HEADER_BYTES) break;

    kept.push(entry);
    used += cost;
  }

  if (kept.length === 0) response.headers.delete('link');
  else response.headers.set('link', kept.join(', '));
}
