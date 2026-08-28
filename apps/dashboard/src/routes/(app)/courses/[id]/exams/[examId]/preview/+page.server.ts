import { error } from '@sveltejs/kit';

import { classroomhub, getApiHeaders } from '$lib/utils/services/api';
import { safeServerApi } from '$lib/utils/services/api/server';

/**
 * The paper as a candidate is served it.
 *
 * The answer keys are already stripped by the time this arrives — the endpoint serves the
 * delivery form of the paper, the same one a sitter receives — so nothing here has to
 * remember to remove them.
 */
export const load = async ({ params, cookies }) => {
  const [examResult, previewResult] = await Promise.all([
    safeServerApi(() =>
      classroomhub.exam[':examId'].$get({ param: { examId: params.examId } }, getApiHeaders(cookies, ''))
    ),
    safeServerApi(() =>
      classroomhub.exam[':examId'].preview.$get({ param: { examId: params.examId } }, getApiHeaders(cookies, ''))
    )
  ]);

  if (!examResult.ok) {
    throw error(404, 'Không tìm thấy đề thi này');
  }

  return {
    courseId: params.id,
    examId: params.examId,
    title: examResult.body.data.title,
    // A paper with no questions cannot be frozen, and the endpoint refuses rather than
    // returning an empty one. The screen says so instead of failing to load.
    preview: previewResult.ok ? previewResult.body.data : null
  };
};
