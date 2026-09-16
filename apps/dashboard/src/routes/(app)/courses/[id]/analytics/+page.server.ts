import type { CourseAnalytics } from '$features/course/utils/types';
import { classroomhub } from '$lib/utils/services/api';
import { getApiHeaders } from '$lib/utils/services/api';
import { safeServerApi } from '$lib/utils/services/api/server';

export const load = async ({ params, cookies }) => {
  const courseId = params.id || '';
  if (!courseId) {
    return {
      courseId: '',
      courseAnalytics: null,
      loadFailed: false
    };
  }

  // Fetch analytics using single API call
  const result = await safeServerApi<{ success: true; data: CourseAnalytics }>(() =>
    classroomhub.course[':courseId']['analytics'].$get(
      {
        param: { courseId }
      },
      getApiHeaders(cookies, '')
    )
  );
  const courseAnalytics: CourseAnalytics | null = result.ok ? result.body.data : null;

  return {
    courseId,
    courseAnalytics,
    // A failed request is not a course without analytics. Collapsing the two tells a
    // teacher their course has no data when the fetch simply did not arrive.
    loadFailed: !result.ok
  };
};
