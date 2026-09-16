import { sectionMetaTags } from '$lib/utils/functions/document-title';

export const load = async ({ params = { id: '' }, parent }) => {
  const { localeCookie } = await parent();

  return {
    courseId: params.id,
    // The browser tab. The locale comes from the layout rather than the `$t` store, which is a
    // module-level singleton and would share one locale across concurrent server requests.
    pageMetaTags: await sectionMetaTags(localeCookie, 'course.navItem.people.title')
  };
};
