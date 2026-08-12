import { classroomhub } from '$lib/utils/services/api';
import { getApiKeyHeaders, safeServerApi } from '$lib/utils/services/api/server';

/**
 * Papers this course can deliver as an exam: detached containers, which is what copying a
 * course exercise produces. The working exercises are loaded too, but only as sources to
 * copy from — an exam must not deliver something enrolled students can already open
 * without a clock.
 */
export const load = async ({ params }) => {
  const [containers, copyable] = await Promise.all([
    safeServerApi(() =>
      classroomhub.exam.course[':courseId'].containers.$get({ param: { courseId: params.id } }, getApiKeyHeaders())
    ),
    safeServerApi(() =>
      classroomhub.exam.course[':courseId']['copyable-exercises'].$get(
        { param: { courseId: params.id } },
        getApiKeyHeaders()
      )
    )
  ]);

  return {
    courseId: params.id,
    containers: containers.ok ? containers.body.data : [],
    copyable: copyable.ok ? copyable.body.data : []
  };
};
