import type { ListSubmissionsForGradingSuccess } from '$features/course/utils/types';
import { classroomhub } from '$lib/utils/services/api';
import { getApiHeaders } from '$lib/utils/services/api';
import { safeServerApi } from '$lib/utils/services/api/server';

export const load = async ({ params, cookies }) => {
  const courseId = params.id || '';

  if (!courseId) {
    return {
      courseId: '',
      sections: [],
      submissionIdData: {},
      exams: []
    };
  }

  // Exams sit beside the exercise submissions rather than in a section of their own:
  // both are "what the learners handed in", and a teacher looking for one is usually
  // willing to see the other. A failure here empties that tab and leaves grading alone.
  const [result, exams] = await Promise.all([
    safeServerApi<ListSubmissionsForGradingSuccess>(() =>
      classroomhub.course[':courseId'].submission['for-grading'].$get(
        {
          param: { courseId }
        },
        getApiHeaders(cookies)
      )
    ),
    safeServerApi(() => classroomhub.exam.course[':courseId'].$get({ param: { courseId } }, getApiHeaders(cookies, '')))
  ]);

  return {
    courseId,
    sections: result.ok && result.body.data ? result.body.data.sections || [] : [],
    submissionIdData: result.ok && result.body.data ? result.body.data.submissionIdData || {} : {},
    exams: exams.ok ? exams.body.data : []
  };
};
