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
    lesson: lesson,
    /**
     * The browser tab. Every screen in this section served the platform's own title, so a
     * teacher working across an exam, its attempts and the source exercise had a row of
     * identical tabs and a useless history. Only the title is set; everything else still
     * falls back to the site defaults.
     */
    pageMetaTags: lesson?.title ? Object.freeze({ title: lesson.title }) : undefined
  };
};
