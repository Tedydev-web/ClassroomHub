import type { ListSubmissionsForGradingSuccess } from '$features/course/utils/types';
import { classroomhub } from '$lib/utils/services/api';
import { getApiHeaders } from '$lib/utils/services/api';
import { safeServerApi } from '$lib/utils/services/api/server';

/**
 * Everything the learners handed in: the exercises, and one exam's results.
 *
 * The exam half is the results screen itself, which used to be a page of its own. Asking
 * for a paper's results is what finalises attempts whose clocks ran out and scores the ones
 * nothing has marked, so the status column is truthful the moment a teacher looks. That
 * write happens on the server; this only has to ask early enough.
 *
 * Which paper comes from `?exam=`, so the tab can be linked to and the old results URL has
 * somewhere to send its bookmarks. Without it, the newest paper — the exams list is ordered
 * newest first, and the newest is the one a teacher has just closed.
 */
export const load = async ({ params, url, cookies }) => {
  const courseId = params.id || '';

  if (!courseId) {
    return { courseId: '', sections: [], submissionIdData: {}, exams: [], examId: null, rows: [], examsFailed: false };
  }

  const [result, exams] = await Promise.all([
    safeServerApi<ListSubmissionsForGradingSuccess>(() =>
      classroomhub.course[':courseId'].submission['for-grading'].$get({ param: { courseId } }, getApiHeaders(cookies))
    ),
    safeServerApi(() => classroomhub.exam.course[':courseId'].$get({ param: { courseId } }, getApiHeaders(cookies, '')))
  ]);

  const examList = exams.ok ? exams.body.data : [];
  const asked = url.searchParams.get('exam');
  // An `?exam=` naming a paper this course does not have is treated as absent rather than
  // as an error: it is a stale bookmark, and the newest paper is a better answer than a 404.
  const examId = examList.find((exam) => exam.id === asked)?.id ?? examList[0]?.id ?? null;

  const rows = examId
    ? await safeServerApi(() =>
        classroomhub.exam[':examId'].results.$get({ param: { examId } }, getApiHeaders(cookies, ''))
      )
    : null;

  return {
    courseId,
    sections: result.ok && result.body.data ? result.body.data.sections || [] : [],
    submissionIdData: result.ok && result.body.data ? result.body.data.submissionIdData || {} : {},
    exams: examList.map((exam) => ({ id: exam.id, title: exam.title })),
    examId,
    rows: rows?.ok ? rows.body.data : [],
    // Told apart from "nobody sat anything", which is what an empty list on a failed fetch
    // would otherwise claim to a teacher who has no way to know the difference.
    examsFailed: !exams.ok || (rows !== null && !rows.ok)
  };
};
