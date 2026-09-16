import { sectionMetaTags } from '$lib/utils/functions/document-title';
import { classroomhub, getApiHeaders } from '$lib/utils/services/api';
import { safeServerApi } from '$lib/utils/services/api/server';
import type { MarksPageData } from '$features/course/utils/marks-utils';

export const load = async ({ params, cookies }) => {
  const courseId = params.id || '';
  if (!courseId) {
    return {
      courseId: '',
      marksData: null,
      loadFailed: false
    };
  }

  const result = await safeServerApi<{ success: true; data: MarksPageData }>(() =>
    classroomhub.course[':courseId'].mark.gradebook.$get({ param: { courseId } }, getApiHeaders(cookies, ''))
  );
  const marksData: MarksPageData | null = result.ok ? result.body.data : null;

  return {
    courseId,
    marksData,
    // A failed gradebook fetch must not reach the page as an empty one: "no students"
    // and "we could not load your students" are different messages, and only the
    // second is true here.
    loadFailed: !result.ok,
    // The browser tab. Resolved from the locale cookie rather than the `$t` store, which is a
    // module-level singleton and would share one locale across concurrent requests.
    pageMetaTags: await sectionMetaTags(cookies.get('classroomhub_locale'), 'course.navItem.marks.title')
  };
};
