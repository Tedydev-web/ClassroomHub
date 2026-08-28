import { error } from '@sveltejs/kit';

import { classroomhub, getApiHeaders } from '$lib/utils/services/api';
import { safeServerApi } from '$lib/utils/services/api/server';

/**
 * Loads one exam's settings so they can be changed.
 *
 * Only the settings are returned. The exam row also carries its frozen paper — every
 * question with its answer key — and this page renders on the server, so returning the
 * whole row would write the key into the HTML of a page that needs a title and a clock.
 */
export const load = async ({ params, cookies }) => {
  const result = await safeServerApi(() =>
    classroomhub.exam[':examId'].$get({ param: { examId: params.examId } }, getApiHeaders(cookies, ''))
  );

  if (!result.ok) {
    throw error(404, 'Không tìm thấy đề thi này');
  }

  const exam = result.body.data;

  return {
    courseId: params.id,
    examId: params.examId,
    status: exam.status,
    settings: {
      title: exam.title,
      mode: exam.mode,
      workingSeconds: exam.workingSeconds,
      opensAt: exam.opensAt,
      closesAt: exam.closesAt,
      maxAttempts: exam.maxAttempts,
      requiresName: exam.requiresName,
      requiresClass: exam.requiresClass,
      requiresCandidateNumber: exam.requiresCandidateNumber,
      scoreVisibility: exam.scoreVisibility,
      answerVisibility: exam.answerVisibility,
      commentVisibility: exam.commentVisibility,
      revealThreshold: exam.revealThreshold
    }
  };
};
