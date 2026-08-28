import { error } from '@sveltejs/kit';

import { classroomhub, getApiHeaders } from '$lib/utils/services/api';
import { safeServerApi } from '$lib/utils/services/api/server';

/**
 * The answer key of the paper that was sat, so a wrong one can be corrected.
 *
 * The key comes from the server already reduced to what this screen needs — each
 * question's options and the key currently in force — rather than from the frozen paper,
 * which is far larger and carries content this screen never draws.
 */
export const load = async ({ params, cookies }) => {
  const [examResult, keysResult] = await Promise.all([
    safeServerApi(() =>
      classroomhub.exam[':examId'].$get({ param: { examId: params.examId } }, getApiHeaders(cookies, ''))
    ),
    safeServerApi(() =>
      classroomhub.exam[':examId']['answer-keys'].$get({ param: { examId: params.examId } }, getApiHeaders(cookies, ''))
    )
  ]);

  if (!examResult.ok) {
    throw error(404, 'Không tìm thấy đề thi này');
  }

  return {
    courseId: params.id,
    examId: params.examId,
    title: examResult.body.data.title,
    // An exam that never opened has no frozen paper, and the endpoint says so with a 409
    // rather than an empty list. The screen states that instead of failing to load.
    questions: keysResult.ok ? keysResult.body.data : []
  };
};
