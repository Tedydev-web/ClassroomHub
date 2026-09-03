import { redirect } from '@sveltejs/kit';

/**
 * The exam's screens became tabs of one page, the way an exercise's always were. This route
 * stays to carry the links that were copied while it was a page of its own.
 */
export const load = async ({ params }) => {
  redirect(307, `/courses/${params.id}/exams/${params.examId}?tab=paper`);
};
