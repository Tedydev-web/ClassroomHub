import type { GetExerciseSuccess, ListExerciseSubmissionsSuccess } from '$features/course/utils/types';
import { classroomhub, getApiHeaders } from '$lib/utils/services/api';
import { safeServerApi } from '$lib/utils/services/api/server';

export const load = async ({ params, cookies }) => {
  const courseId = params.id || '';
  const exerciseId = params.exerciseId || '';

  if (!courseId || !exerciseId) {
    return { courseId, exerciseId, exercise: null, submissions: [], mySubmissions: [], loadFailed: false };
  }

  const headers = getApiHeaders(cookies);

  const [exerciseResult, overviewResult] = await Promise.all([
    safeServerApi<GetExerciseSuccess>(() =>
      classroomhub.course[':courseId'].exercise[':exerciseId'].$get({ param: { courseId, exerciseId } }, headers)
    ),
    safeServerApi<ListExerciseSubmissionsSuccess>(() =>
      classroomhub.course[':courseId'].exercise[':exerciseId']['submissions'].$get(
        { param: { courseId, exerciseId } },
        headers
      )
    )
  ]);
  const exercise = exerciseResult.ok && exerciseResult.body.data ? exerciseResult.body.data : null;
  const overview =
    overviewResult.ok && overviewResult.body.data ? overviewResult.body.data : { mySubmission: [], allSubmissions: [] };

  const mySubmissionData = Array.isArray(overview.mySubmission) ? overview.mySubmission : [];
  const mySubmissions = mySubmissionData;

  const submissions = Array.isArray(overview.allSubmissions) ? overview.allSubmissions : [];

  return {
    courseId,
    exerciseId,
    exercise,
    submissions,
    mySubmissions,
    // The authoring screen renders from the store, so a null exercise reaches a teacher as
    // an *empty* exercise — and saving that would overwrite the real one with nothing.
    // Failure has to stop the page rather than reach it as data.
    loadFailed: !exerciseResult.ok,
    /**
     * The browser tab. Every screen in this section served the platform's own title, so a
     * teacher working across an exam, its attempts and the source exercise had a row of
     * identical tabs and a useless history. Only the title is set; everything else still
     * falls back to the site defaults.
     */
    pageMetaTags: exercise?.title ? Object.freeze({ title: exercise.title }) : undefined
  };
};
