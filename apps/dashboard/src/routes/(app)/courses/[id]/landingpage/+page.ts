import { sectionMetaTags } from '$lib/utils/functions/document-title';

export const load = async ({ params, parent }) => {
  const { localeCookie } = await parent();

  return {
    courseId: params.id || '',
    // The browser tab. The locale comes from the layout rather than the `$t` store, which is a
    // module-level singleton and would share one locale across concurrent server requests.
    pageMetaTags: await sectionMetaTags(localeCookie, 'course.navItems.nav_landing_page')
  };
};
