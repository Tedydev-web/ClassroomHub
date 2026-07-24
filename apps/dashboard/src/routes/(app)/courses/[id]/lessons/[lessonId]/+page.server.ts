import type { GetLessonSuccess } from '$features/course/utils/types';
import { classroomhub, getApiHeaders } from '$lib/utils/services/api';
import { safeServerApi } from '$lib/utils/services/api/server';

export const load = async ({ params, cookies }) => {
  const courseId = params.id || '';
  const lessonId = params.lessonId || '';

  if (!courseId || !lessonId) {
    return { courseId, lessonId, lesson: null };
  }

  const result = await safeServerApi<GetLessonSuccess>(() =>
    classroomhub.course[':courseId'].lesson[':lessonId'].$get({ param: { courseId, lessonId } }, getApiHeaders(cookies))
  );
  const lesson = result.ok ? result.body.data : null;

  return {
    courseId,
    lessonId,
    lesson: lesson
  };
};
