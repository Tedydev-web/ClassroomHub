import { error } from '@sveltejs/kit';

import { classroomhub, getApiHeaders } from '$lib/utils/services/api';
import { safeServerApi } from '$lib/utils/services/api/server';

/** One sitting in full, including the frozen paper so the teacher can see the key. */
export const load = async ({ params, cookies }) => {
  const result = await safeServerApi(() =>
    classroomhub.exam.attempt[':attemptId'].$get({ param: { attemptId: params.attemptId } }, getApiHeaders(cookies, ''))
  );

  if (!result.ok) {
    throw error(404, 'Không tìm thấy bài làm này');
  }

  return {
    courseId: params.id,
    examId: params.examId,
    attemptId: params.attemptId,
    attempt: result.body.data.attempt,
    paper: result.body.data.paper,
    corrections: result.body.data.corrections
  };
};
