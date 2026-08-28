import { error } from '@sveltejs/kit';

import { classroomhub, getApiHeaders } from '$lib/utils/services/api';
import { safeServerApi } from '$lib/utils/services/api/server';

/**
 * Loads the results for one exam.
 *
 * Asking for this list is what finalises attempts whose clocks ran out, so the teacher
 * never opens the page to a stale "still sitting" for a paper that ended yesterday. The
 * write happens on the server; this only has to ask early enough.
 */
export const load = async ({ params, cookies }) => {
  const [examResult, rowsResult] = await Promise.all([
    safeServerApi(() =>
      classroomhub.exam[':examId'].$get({ param: { examId: params.examId } }, getApiHeaders(cookies, ''))
    ),
    safeServerApi(() =>
      classroomhub.exam[':examId'].results.$get({ param: { examId: params.examId } }, getApiHeaders(cookies, ''))
    )
  ]);

  if (!examResult.ok || !rowsResult.ok) {
    throw error(404, 'Không tìm thấy đề thi này');
  }

  const exam = examResult.body.data;

  return {
    courseId: params.id,
    examId: params.examId,
    // Named fields, not the row. The row carries the frozen paper with every answer key
    // on it, and this page renders on the server, so returning it wrote forty kilobytes
    // of answer key into the HTML of a screen that shows a title.
    exam: { id: exam.id, title: exam.title, status: exam.status },
    rows: rowsResult.body.data
  };
};
