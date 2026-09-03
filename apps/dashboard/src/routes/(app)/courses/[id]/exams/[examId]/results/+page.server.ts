import { redirect } from '@sveltejs/kit';

/**
 * The results moved into the course's Submissions page, where the exercises' submissions
 * already were. This route stays only to carry the links that were copied while it was a
 * page — the sidebar, the exam list and every bookmark a teacher made — to the screen that
 * now shows the same thing.
 */
export const load = async ({ params }) => {
  redirect(307, `/courses/${params.id}/submissions?exam=${params.examId}`);
};
