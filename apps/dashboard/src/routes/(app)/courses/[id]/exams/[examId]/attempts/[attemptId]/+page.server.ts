import { error } from '@sveltejs/kit';

import { classroomhub, getApiHeaders } from '$lib/utils/services/api';
import { safeServerApi } from '$lib/utils/services/api/server';
import { resolveDocumentTitle } from '$lib/utils/functions/document-title';
import { readCandidateName } from '$features/exam/read-candidate-name';

/** One sitting in full, including the frozen paper so the teacher can see the key. */
export const load = async ({ params, cookies }) => {
  const result = await safeServerApi(() =>
    classroomhub.exam.attempt[':attemptId'].$get({ param: { attemptId: params.attemptId } }, getApiHeaders(cookies, ''))
  );

  if (!result.ok) {
    throw error(404, 'Không tìm thấy bài làm này');
  }

  return {
    courseId: params.id,
    examId: params.examId,
    attemptId: params.attemptId,
    attempt: result.body.data.attempt,
    paper: result.body.data.paper,
    corrections: result.body.data.corrections,
    // The browser tab names the candidate, as the page heading does, so a teacher marking several
    // sittings can tell the tabs apart. Falls back to the page's own "no name" wording.
    pageMetaTags: Object.freeze({
      title:
        readCandidateName(result.body) ??
        (await resolveDocumentTitle(cookies.get('classroomhub_locale'), 'exam.results.no_name'))
    })
  };
};
