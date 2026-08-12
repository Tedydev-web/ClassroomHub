import { error } from '@sveltejs/kit';

import { classroomhub } from '$lib/utils/services/api';
import { getApiKeyHeaders, safeServerApi } from '$lib/utils/services/api/server';

/**
 * Loads the results for one exam.
 *
 * Asking for this list is what finalises attempts whose clocks ran out, so the teacher
 * never opens the page to a stale "still sitting" for a paper that ended yesterday. The
 * write happens on the server; this only has to ask early enough.
 */
export const load = async ({ params }) => {
  const [examResult, rowsResult] = await Promise.all([
    safeServerApi(() => classroomhub.exam[':examId'].$get({ param: { examId: params.examId } }, getApiKeyHeaders())),
    safeServerApi(() =>
      classroomhub.exam[':examId'].results.$get({ param: { examId: params.examId } }, getApiKeyHeaders())
    )
  ]);

  if (!examResult.ok || !rowsResult.ok) {
    throw error(404, 'Không tìm thấy đề thi này');
  }

  return {
    courseId: params.id,
    examId: params.examId,
    exam: examResult.body.data,
    rows: rowsResult.body.data
  };
};
