import type { ListSubmissionsForGradingSuccess } from '$features/course/utils/types';
import { classroomhub } from '$lib/utils/services/api';
import { getApiHeaders } from '$lib/utils/services/api';
import { safeServerApi } from '$lib/utils/services/api/server';

/**
 * Everything the learners handed in: the exercises' submissions, and the exams' sittings.
 *
 * Both halves answer the page's one question — what did they hand in — so the exam half
 * lists sittings, not papers. Managing a paper happens on the paper's own page, which is
 * where the sidebar and the exam list lead.
 *
 * The sittings are read without finalising anything. Asking for one exam's results
 * finalises attempts whose clock ran out and scores the unmarked ones, which is right when
 * a teacher opens that exam and wrong for an overview: it would sweep every paper in the
 * course, including one being sat at that moment, on every refresh.
 */
export const load = async ({ params, cookies }) => {
  const courseId = params.id || '';

  if (!courseId) {
    return { courseId: '', sections: [], submissionIdData: {}, attempts: [], attemptsFailed: false };
  }

  const [result, attempts] = await Promise.all([
    safeServerApi<ListSubmissionsForGradingSuccess>(() =>
      classroomhub.course[':courseId'].submission['for-grading'].$get({ param: { courseId } }, getApiHeaders(cookies))
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
