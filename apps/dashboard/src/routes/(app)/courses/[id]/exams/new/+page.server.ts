import { classroomhub } from '$lib/utils/services/api';
import { getApiKeyHeaders, safeServerApi } from '$lib/utils/services/api/server';

/**
 * Papers this course can deliver as an exam: detached containers, which is what the
 * `.docx` import produces. A working exercise is deliberately not offered — an exam must
 * not deliver something enrolled students can already open without a clock.
 */
export const load = async ({ params }) => {
  const result = await safeServerApi(() =>
    classroomhub.exam.course[':courseId'].containers.$get({ param: { courseId: params.id } }, getApiKeyHeaders())
  );

  return { courseId: params.id, containers: result.ok ? result.body.data : [] };
};
