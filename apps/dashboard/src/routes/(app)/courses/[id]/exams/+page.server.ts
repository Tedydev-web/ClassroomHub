import { sectionMetaTags } from '$lib/utils/functions/document-title';
import { error } from '@sveltejs/kit';

import { classroomhub, getApiHeaders } from '$lib/utils/services/api';
import { safeServerApi } from '$lib/utils/services/api/server';

/** The exams of one course. Authorisation is enforced by the API's course-team check. */
export const load = async ({ params, cookies }) => {
  const result = await safeServerApi(() =>
    classroomhub.exam.course[':courseId'].$get({ param: { courseId: params.id } }, getApiHeaders(cookies, ''))
  );

  if (!result.ok) {
    throw error(404, 'Không tải được danh sách đề thi');
  }

  return {
    courseId: params.id,
    exams: result.body.data,
    // The browser tab. Resolved from the locale cookie rather than the `$t` store, which is a
    // module-level singleton and would share one locale across concurrent requests.
    pageMetaTags: await sectionMetaTags(cookies.get('classroomhub_locale'), 'exam.manage.title')
  };
};
