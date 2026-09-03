import { redirect } from '@sveltejs/kit';

/**
 * The results are a tab of the exam's own page now. This route stays to carry the links
 * that were copied while it was a page — the sidebar, the exam list, and bookmarks.
 */
export const load = async ({ params }) => {
  redirect(307, `/courses/${params.id}/exams/${params.examId}?tab=submissions`);
};
