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
 * every rule on it was settled against a printed Ministry form — so this renders that page,
 * takes the markup it produced, and hands it to the API to turn into a PDF. One design, one
 * place, whichever of the two ways a teacher asks for it.
 */
const STYLESHEET_LINK = /<link\b[^>]*rel=["']stylesheet["'][^>]*>/giu;
const HREF = /href=["']([^"']+)["']/iu;

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
   * The page's stylesheets, fetched and handed over as text.
   *
   * The build emits them as separate files, and the renderer is given markup rather than an
   * address, so a `<link>` in what we send points at nothing. Inlining them here means the
   * document carries its own appearance and the renderer never has to reach back for it.
   */
  const hrefs = (markup.match(STYLESHEET_LINK) ?? [])
    .map((tag) => tag.match(HREF)?.[1])
    .filter((href): href is string => Boolean(href));

  const sheets = await Promise.all(
    hrefs.map(async (href) => {
      try {
        const response = await fetch(new URL(href, pageUrl));

        return response.ok ? await response.text() : '';
      } catch {
        return '';
      }
    })
  );

  const html = markup.replace(STYLESHEET_LINK, '');
  const styles = sheets.filter(Boolean).join('\n');

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
