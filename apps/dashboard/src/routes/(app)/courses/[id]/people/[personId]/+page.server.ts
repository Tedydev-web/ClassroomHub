export const load = async ({ parent }) => {
  const parentData = await parent();

  return {
    courseId: parentData.courseId,
    userId: parentData.personId,
    userCourseAnalytics: parentData.userCourseAnalytics,
    loadFailed: parentData.loadFailed,
    /**
     * The browser tab. A teacher comparing two students had two tabs reading the same platform
     * title; the name is already loaded one level up, so no request is added for it.
     */
    pageMetaTags: parentData.userCourseAnalytics?.user?.fullName
      ? Object.freeze({ title: parentData.userCourseAnalytics.user.fullName })
      : undefined
  };
};
