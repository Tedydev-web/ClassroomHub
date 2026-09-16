import { error } from '@sveltejs/kit';

import { classroomhub, getApiHeaders } from '$lib/utils/services/api';
import { safeServerApi } from '$lib/utils/services/api/server';
import { parseWindowStamp } from '$features/exam/exam-window';

/**
 * One exam, on one page, the way one exercise already is.
 *
 * An exercise is a single route with three tabs and the tab in `?tab=`; an exam was four
 * routes with a bar that changed the path, and clicking a paper in the sidebar landed on
 * the course's submissions page instead of on the paper. Same object, two navigation
 * models. This is the exercise's model, applied to exams.
 *
 * Everything three tabs need is fetched here rather than per tab: the three requests run
 * together, and switching tabs is then instant instead of a round trip each time. Asking
 * for the results is also what finalises attempts whose clock ran out and scores the ones
 * nothing has marked, so the count on the tab is true the moment the page opens.
 */
export const load = async ({ params, cookies }) => {
  const headers = getApiHeaders(cookies, '');

  const [examResult, keysResult, rowsResult] = await Promise.all([
    safeServerApi(() => classroomhub.exam[':examId'].$get({ param: { examId: params.examId } }, headers)),
    safeServerApi(() =>
      classroomhub.exam[':examId']['answer-keys'].$get({ param: { examId: params.examId } }, headers)
    ),
    safeServerApi(() => classroomhub.exam[':examId'].results.$get({ param: { examId: params.examId } }, headers))
  ]);

  if (!examResult.ok) {
    throw error(404, 'Không tìm thấy đề thi này');
  }

  const exam = examResult.body.data;

  /**
   * Postgres returns a `timestamptz` as `2026-08-28 01:38:04+00` — a space, not a `T`.
   * V8 reads that, but a space-separated datetime is outside what the ECMAScript grammar
   * requires any engine to parse, so the browser is handed a plain ISO string instead.
   *
   * Swapping in the `T` alone made it worse rather than better: it turns a string V8
   * accepts into one it rejects, because the offset is `+00` and the grammar wants
   * `+00:00`. Both settings fields then arrived as null and the settings tab drew an empty
   * opening and closing time for an exam that had both. `parseWindowStamp` already fixes
   * both characters, and is the rule the sitting page reads the same window with.
   */
  const asIso = (value: string | null) => parseWindowStamp(value)?.toISOString() ?? null;

  return {
    courseId: params.id,
    examId: params.examId,
    // Named fields, never the row. The exam row carries its frozen paper — every question
    // with its answer key — and this page renders on the server, so returning the row wrote
    // the whole key into the HTML of a screen that shows a title and some settings.
    exam: {
      id: exam.id,
      title: exam.title,
      status: exam.status,
      // The exercise holding this exam's questions. An exam's paper is a copy taken from a
      // container exercise, so "edit the questions" means editing that exercise — and until
      // now no screen said so or offered a way there. An id carries no answer key, so it
      // belongs among the named fields.
      exerciseId: exam.exerciseId,
      mode: exam.mode,
      workingSeconds: exam.workingSeconds,
      opensAt: asIso(exam.opensAt),
      closesAt: asIso(exam.closesAt),
      maxAttempts: exam.maxAttempts,
      requiresName: exam.requiresName,
      requiresClass: exam.requiresClass,
      requiresCandidateNumber: exam.requiresCandidateNumber,
      scoreVisibility: exam.scoreVisibility,
      answerVisibility: exam.answerVisibility,
      commentVisibility: exam.commentVisibility,
      revealThreshold: exam.revealThreshold,
      hasPassword: exam.hasPassword,
      autoSubmitAfterLeaves: exam.autoSubmitAfterLeaves,
      supportContact: exam.supportContact
    },
    // An exam that never opened has no frozen paper, and the endpoint says so with a 409
    // rather than an empty list. The tab states that instead of failing to load.
    questions: keysResult.ok ? keysResult.body.data.questions : [],
    paper: keysResult.ok ? keysResult.body.data.paper : null,
    rows: rowsResult.ok ? rowsResult.body.data : [],
    // Told apart from "nobody sat it", which an empty list on a failed fetch would
    // otherwise claim to a teacher who has no way to know the difference.
    rowsFailed: !rowsResult.ok
  };
};
