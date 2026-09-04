import { error } from '@sveltejs/kit';

import { classroomhub, getApiHeaders } from '$lib/utils/services/api';
import { safeServerApi } from '$lib/utils/services/api/server';

/**
 * The answer sheets, laid out for a printer.
 *
 * A teacher going through a paper in the room hands each candidate their own sheet: what
 * they chose, what the key says, and where the two differ. The workbook already carries all
 * of that, but a spreadsheet is not something anybody hands to a sixteen-year-old.
 *
 * There is no PDF writer behind this. The browser already has one — every print dialog can
 * save to PDF — and it renders Vietnamese correctly without an embedded font, which a
 * server-side writer would have had to carry and be checked glyph by glyph. What the page
 * owes in return is print CSS honest enough that the dialog's preview is the finished sheet.
 */
export const load = async ({ params, url, cookies }) => {
  const headers = getApiHeaders(cookies, '');

  /**
   * The selection travels as attempt ids, which are opaque.
   *
   * The workbook sends its selection in a body precisely so candidate names stay out of the
   * URL; a page cannot do that, so it sends the one identifier that names nobody. Empty
   * means every finished sitting, which is what a teacher printing for the whole class asks
   * for by not choosing anybody.
   */
  const attemptIds = (url.searchParams.get('attempts') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  const [examResult, keysResult, matrixResult] = await Promise.all([
    safeServerApi(() => classroomhub.exam[':examId'].$get({ param: { examId: params.examId } }, headers)),
    safeServerApi(() =>
      classroomhub.exam[':examId']['answer-keys'].$get({ param: { examId: params.examId } }, headers)
    ),
    safeServerApi(() =>
      classroomhub.exam[':examId']['answer-matrix'].$post(
        { param: { examId: params.examId }, json: { attemptIds } },
        headers
      )
    )
  ]);

  if (!examResult.ok) {
    throw error(404, 'Không tìm thấy đề thi này');
  }

  if (!matrixResult.ok) {
    throw error(409, 'Đề thi này chưa có bài nào để in');
  }

  const matrix = matrixResult.body.data;

  /**
   * The letters each question offered, so a sheet can print the options nobody chose.
   *
   * The matrix carries only what was chosen and what is correct; a question where the whole
   * class picked A would otherwise print a single letter and hide that there were four.
   */
  const offered = new Map<number, string[]>();

  if (keysResult.ok) {
    for (const question of keysResult.body.data.questions) {
      const labels = question.options.map((option) => option.label);

      if (labels.length > 0) offered.set(question.position, labels);
    }
  }

  return {
    courseId: params.id,
    examTitle: examResult.body.data.title,
    questions: matrix.questions.map((question) => ({
      position: question.position,
      key: question.key,
      // Whatever the paper offered, or failing that whatever anyone chose plus the key —
      // a sheet with one letter on it is still truthful, and better than no sheet.
      letters: offered.get(question.position) ?? []
    })),
    rows: matrix.rows
  };
};
