import type { GetCourseSuccess } from '$features/course/utils/types';
import { classroomhub, getApiHeaders } from '$lib/utils/services/api';
import { safeServerApi } from '$lib/utils/services/api/server';
import { error } from '@sveltejs/kit';

export const load = async ({ params, cookies }) => {
  const courseId = params.id || '';
  if (!courseId) {
    throw error(404, 'Course not found');
  }

  const result = await safeServerApi<GetCourseSuccess>(() =>
    classroomhub.course[':courseId'].$get(
      {
        param: { courseId },
        query: {}
      },
      getApiHeaders(cookies)
    )
  );

  if (!result.ok) {
    if (result.status === 403 || result.status === 404) {
      throw error(404, 'Course not found');
    }

    throw error(500, result.message);
  }

  return {
    courseId,
    course: result.body.data
  };
};
