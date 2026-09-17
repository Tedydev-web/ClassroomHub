import { sectionMetaTags } from '$lib/utils/functions/document-title';
import { classroomhub, getApiHeaders } from '$lib/utils/services/api';
import { safeServerApi } from '$lib/utils/services/api/server';

/**
 * Papers this course can deliver as an exam: detached containers, which is what copying a
 * course exercise produces. The working exercises are loaded too, but only as sources to
 * copy from — an exam must not deliver something enrolled students can already open
 * without a clock.
 */
export const load = async ({ params, cookies }) => {
  const [containers, copyable] = await Promise.all([
    safeServerApi(() =>
      classroomhub.exam.course[':courseId'].containers.$get(
        { param: { courseId: params.id } },
        getApiHeaders(cookies, '')
      )
    ),
    safeServerApi(() =>
      classroomhub.exam.course[':courseId']['copyable-exercises'].$get(
        { param: { courseId: params.id } },
        getApiHeaders(cookies, '')
      )
    )
  ]);

  return {
    courseId: params.id,
    containers: containers.ok ? containers.body.data : [],
    copyable: copyable.ok ? copyable.body.data : [],
    // Without this the page tells a teacher the course has no container to deliver and
    // offers to import one — when in fact the list simply did not arrive. Acting on that
    // message creates a container the teacher did not need.
    loadFailed: !containers.ok || !copyable.ok,
    // The browser tab. Resolved from the locale cookie rather than the `$t` store, which is a
    // module-level singleton and would share one locale across concurrent requests.
    pageMetaTags: await sectionMetaTags(cookies.get('classroomhub_locale'), 'exam.manage.create')
  };
};
