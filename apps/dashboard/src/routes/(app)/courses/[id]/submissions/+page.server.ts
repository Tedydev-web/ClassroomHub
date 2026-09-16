import type { ListSubmissionsForGradingSuccess } from '$features/course/utils/types';
import { classroomhub } from '$lib/utils/services/api';
import { getApiHeaders } from '$lib/utils/services/api';
import { safeServerApi } from '$lib/utils/services/api/server';

/**
 * Everything the learners handed in, and the papers they sat.
 *
 * Two of the three tabs answer the page's one question — what did they hand in. The third
 * is the exams themselves, which used to be a button leading off the page: a teacher who
 * came here to look at a sitting and then wanted to close the paper had to leave and come
 * back.
 *
 * The sittings are read without finalising anything. Asking for one exam's results
 * finalises attempts whose clock ran out and scores the unmarked ones, which is right when
 * a teacher opens that exam and wrong for an overview: it would sweep every paper in the
 * course, including one being sat at that moment, on every refresh.
 */
export const load = async ({ params, cookies }) => {
  const courseId = params.id || '';

  if (!courseId) {
    return {
      courseId: '',
      sections: [],
      submissionIdData: {},
      attempts: [],
      attemptsFailed: false,
      exams: [],
      submissionsFailed: false,
      examsFailed: false
    };
  }

  const [result, attempts, exams] = await Promise.all([
    safeServerApi<ListSubmissionsForGradingSuccess>(() =>
      classroomhub.course[':courseId'].submission['for-grading'].$get({ param: { courseId } }, getApiHeaders(cookies))
    ),
    safeServerApi(() =>
      classroomhub.exam.course[':courseId'].attempts.$get({ param: { courseId } }, getApiHeaders(cookies, ''))
    ),
    safeServerApi(() => classroomhub.exam.course[':courseId'].$get({ param: { courseId } }, getApiHeaders(cookies, '')))
  ]);

  return {
    courseId,
    sections: result.ok && result.body.data ? result.body.data.sections || [] : [],
    submissionIdData: result.ok && result.body.data ? result.body.data.submissionIdData || {} : {},
    attempts: attempts.ok ? attempts.body.data : [],
    // Told apart from "nobody sat anything", which is what an empty list on a failed fetch
    // would otherwise claim to a teacher who has no way to know the difference.
    attemptsFailed: !attempts.ok,
    exams: exams.ok ? exams.body.data : [],
    // The sittings tab already told the truth. The other two claimed nothing was handed in
    // and no paper exists, which a teacher has no way to tell apart from a failed fetch.
    submissionsFailed: !result.ok,
    examsFailed: !exams.ok
  };
};
