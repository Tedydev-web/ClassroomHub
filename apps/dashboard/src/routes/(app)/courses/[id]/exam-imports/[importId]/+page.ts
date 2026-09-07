export const load = ({ params, url }) => ({
  courseId: params.id,
  importId: params.importId,
  // Anything but the exam target is an exercise import, which is what every link written
  // before this parameter existed means.
  target: url.searchParams.get('target') === 'exam' ? ('exam' as const) : ('exercise' as const)
});
