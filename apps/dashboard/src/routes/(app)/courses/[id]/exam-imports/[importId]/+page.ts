import { sectionMetaTags } from '$lib/utils/functions/document-title';

export const load = async ({ params, url, parent }) => {
  const { localeCookie } = await parent();

  return {
    courseId: params.id,
    importId: params.importId,
    // Anything but the exam target is an exercise import, which is what every link written
    // before this parameter existed means.
    target: url.searchParams.get('target') === 'exam' ? ('exam' as const) : ('exercise' as const),
    // The browser tab. The locale comes from the layout rather than the `$t` store, which is a
    // module-level singleton and would share one locale across concurrent server requests.
    // The review screen sets its own <title> in <svelte:head>, but a page-level <title> never
    // reaches the server-rendered head — the root layout's meta tags are the one that renders.
    pageMetaTags: await sectionMetaTags(localeCookie, 'exam_import.review.page_title')
  };
};
