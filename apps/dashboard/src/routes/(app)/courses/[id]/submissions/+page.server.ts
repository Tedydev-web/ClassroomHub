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
      attempts: [],
      attemptsFailed: false
    };
  }

  // Exams sit beside the exercise submissions rather than in a section of their own:
  // both are "what the learners handed in", and a teacher looking for one is usually
  // willing to see the other. What is fetched is the sittings, not the papers — the papers
  // have their own page, and listing them here made this tab a copy of it. A failure here
  // empties that tab and leaves grading alone.
  const [result, attempts] = await Promise.all([
    safeServerApi<ListSubmissionsForGradingSuccess>(() =>
      classroomhub.course[':courseId'].submission['for-grading'].$get(
        {
          param: { courseId }
        },
        getApiHeaders(cookies)
      )
    ),
    safeServerApi(() =>
      classroomhub.exam.course[':courseId'].attempts.$get({ param: { courseId } }, getApiHeaders(cookies, ''))
    )
  ]);

  return {
    courseId,
    sections: result.ok && result.body.data ? result.body.data.sections || [] : [],
    submissionIdData: result.ok && result.body.data ? result.body.data.submissionIdData || {} : {},
    attempts: attempts.ok ? attempts.body.data : [],
    // Told apart from "nobody sat anything", which is what an empty list on a failed fetch
    // would otherwise claim to a teacher who has no way to know the difference.
    attemptsFailed: !attempts.ok
  };
};
