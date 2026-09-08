/** The `course.metadata` key holding the self-enrollment setting. */
export const SELF_ENROLLMENT_METADATA_KEY = 'allowSelfEnrollment';

/**
 * The key this setting used to live under. Still read as a fallback: there is no
 * backfill, so a course only gains the current key the first time its settings
 * are saved.
 */
export const LEGACY_SELF_ENROLLMENT_METADATA_KEY = 'allowNewStudent';

type SelfEnrollmentMetadata = {
  allowSelfEnrollment?: boolean | null;
  /** @deprecated Read-only legacy key. See {@link LEGACY_SELF_ENROLLMENT_METADATA_KEY}. */
  allowNewStudent?: boolean | null;
};

/**
 * Whether students may enroll themselves in this course from its landing page
 * or from Explore.
 *
 * This gates *self*-enrollment only. Course invite links and People > Add people
 * bypass it by design, and it never affects students who already joined.
 *
 * Absent means allowed: a course that has never had the setting saved is open,
 * which is what every read site did before the setting was centralized here.
 *
 * The SQL equivalent lives in `getExploreCourses` (packages/db) and must stay in
 * lockstep with this fallback order.
 */
export function isSelfEnrollmentAllowed(metadata: SelfEnrollmentMetadata | null | undefined): boolean {
  return metadata?.allowSelfEnrollment ?? metadata?.allowNewStudent ?? true;
}

/**
 * Whether a course's exercise list must be narrowed to what this viewer is assigned.
 *
 * Assignment scoping is a student rule, so it applies to a viewer who is a student in the
 * course's group and to nobody else. Two viewers are not students and are easy to conflate:
 * a teacher, who has a membership with another role, and an organisation owner, who has no
 * membership in this course's group at all.
 *
 * The second one is why this exists as a named rule. Treating "no membership" as "assigned
 * nothing" removed every exercise from the course for the person most likely to be
 * authoring them, while leaving the lessons in place — so the course looked like it simply
 * had no exercises, with nothing logged and nothing to click.
 */
export function shouldScopeExercisesToAssignments(
  viewer: { roleId: number } | null | undefined,
  studentRoleId: number
): boolean {
  return viewer?.roleId === studentRoleId;
}
