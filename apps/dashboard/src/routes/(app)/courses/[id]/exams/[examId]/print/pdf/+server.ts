import { error } from '@sveltejs/kit';

import { classroomhub, getApiHeaders } from '$lib/utils/services/api';

/**
 * The printed answer sheets as a file the browser saves.
 *
 * A teacher asking for sheets was being handed the browser's print dialog: a second screen
 * to read, a destination to choose and a set of margins to correct, for a document that was
 * finished before the dialog opened. The workbook beside it downloads on one click, and the
 * two buttons sit next to each other.
 *
 * The layout is not rebuilt here. The sheet page next door is the only description of it —
 * every rule on it was settled against a printed Ministry form — so this renders that page
 * and hands the markup to the API to turn into a PDF. One design, one place, whichever of
 * the two ways a teacher asks for it.
 */
const STYLESHEET_LINK = /<link\b[^>]*rel=["']stylesheet["'][^>]*>/giu;
const IMAGE_SOURCE = /(<img\b[^>]*\bsrc=["'])([^"']+)(["'])/giu;
const HREF = /href=["']([^"']+)["']/iu;

/** A page's worth of stylesheet is kilobytes; anything of this order is not one. */
const MAX_STYLESHEET_BYTES = 2_000_000;

/**
 * What the file must not carry, whatever the renderer decides about print media.
 *
 * The sheet hides its own toolbar under `@media print`, which is true of a print dialog and
 * an assumption about anything else. Stated here as well, the strip of buttons cannot reach
 * the file by way of a renderer that drew the screen instead of the page.
 */
const PRINT_OVERRIDES = `
  .toolbar { display: none !important; }
`;

export const POST = async ({ params, request, fetch, url, cookies }) => {
  const body = await request.json().catch(() => ({}));
  const attemptIds: string[] = Array.isArray(body?.attemptIds)
    ? body.attemptIds.filter((id: unknown): id is string => typeof id === 'string')
    : [];

  // The same query the print page reads when it is opened in a tab, so the file and the
  // preview cannot disagree about the language or the key.
  const query = new URLSearchParams();
  if (typeof body?.locale === 'string') query.set('lang', body.locale);
  if (body?.includeAnswerKey === false) query.set('key', 'off');
  if (attemptIds.length > 0) query.set('attempts', attemptIds.join(','));

  const pageUrl = new URL(`/courses/${params.id}/exams/${params.examId}/print?${query}`, url.origin);
  const page = await fetch(pageUrl);
  if (!page.ok) error(page.status, 'The answer sheets could not be rendered');

  const markup = await page.text();

  /**
   * The page's stylesheets, fetched as text and handed over as text.
   *
   * The renderer is given markup rather than an address, and it does not follow a `<link>`
   * in markup it was handed — measured, not assumed: a document carrying the link, with or
   * without a `<base>`, comes back with none of its own styling. What it does honour is a
   * stylesheet passed alongside the markup, so the styles have to arrive as content. The
   * first version of this endpoint sent none, and produced a sheet with no frames, no marks
   * on the answers and the toolbar printed across the top.
   *
   * Fetched with the platform's own `fetch` rather than the event's: the event's is routed
   * through the app, and a built asset is not a route.
   */
  const hrefs = (markup.match(STYLESHEET_LINK) ?? [])
    .map((tag) => tag.match(HREF)?.[1])
    .filter((href): href is string => Boolean(href));

  const sheets = await Promise.all(
    hrefs.map(async (href) => {
      try {
        const response = await globalThis.fetch(new URL(href, pageUrl));
        if (!response.ok) return '';

        const text = await response.text();

        return text.length > MAX_STYLESHEET_BYTES ? '' : text;
      } catch {
        return '';
      }
    })
  );

  const styles = [...sheets.filter(Boolean), PRINT_OVERRIDES].join('\n');
  if (sheets.every((sheet) => sheet === '')) {
    console.error('answer sheet pdf: no stylesheet could be read for', pageUrl.pathname);
    error(502, 'The answer sheets could not be rendered');
  }

  /**
   * Images the renderer will go and get, given somewhere to get them from.
   *
   * Unlike the stylesheets these do load, so they only need an address that means something
   * on its own: markup handed over has no page to be relative to, and the sheet's own marks
   * are written relative to the site root.
   */
  const html = markup
    .replace(STYLESHEET_LINK, '')
    .replace(IMAGE_SOURCE, (tag, open: string, source: string, close: string) => {
      if (/^(?:https?:|data:)/iu.test(source)) return tag;

      return `${open}${new URL(source, pageUrl).href}${close}`;
    });

  const response = await classroomhub.exam[':examId']['answer-sheets'].$post(
    { param: { examId: params.examId }, json: { attemptIds, html, styles } },
    getApiHeaders(cookies, '')
  );

  if (!response.ok) error(response.status, 'The answer sheets could not be rendered');

  return new Response(await response.arrayBuffer(), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': response.headers.get('content-disposition') ?? 'attachment; filename="answer-sheets.pdf"'
    }
  });
};
