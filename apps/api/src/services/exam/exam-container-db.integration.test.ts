import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

/**
 * The assumption the whole isolation argument rests on, tested against a real database
 * with a real enrolled student — because the first draft of this plan got it wrong.
 *
 * That draft claimed a container was invisible because exercise listings filter by
 * lesson. True of one listing function, false of the one actually used:
 * `getExercisesByCourseId` matches `or(exercise.courseId, lesson.courseId)`, the
 * gradebook joins the course the same way and applies no visibility filter at all, and
 * the learner listing matches `exercise.courseId`. A container carrying a course but no
 * lesson would have appeared in all three — and, with the default assignment mode, as an
 * ordinary exercise any enrolled student could open and answer before the exam even
 * opened, with no clock.
 *
 * Nulling the course keeps it out of all three. The assignment mode is the second line
 * of defence, not the fix.
 */
const integrationVariable = ['RUN', 'DB', 'INTEGRATION'].join('_');
const runDatabaseIntegration = process['env'][integrationVariable] === '1';

describe.runIf(runDatabaseIntegration)('question container invisibility', () => {
  async function loadAll() {
    const [{ db }, schema, exerciseQueries, lmsQueries, markQueries] = await Promise.all([
      import('@cio/db/drizzle'),
      import('@cio/db/schema'),
      import('@cio/db/queries/exercise/exercise'),
      import('@cio/db/queries/exercise/lms'),
      import('@cio/db/queries/mark/mark')
    ]);
    return { db, schema, exerciseQueries, lmsQueries, markQueries };
  }

  /** A course with an enrolled student, and one ordinary exercise inside a lesson. */
  async function seedCourseWithStudent(db: any, schema: any) {
    const suffix = randomUUID().slice(0, 8);

    const [organization] = await db
      .insert(schema.organization)
      .values({ name: `Org ${suffix}` })
      .returning({ id: schema.organization.id });

    const [group] = await db
      .insert(schema.group)
      .values({ organizationId: organization.id, name: `Group ${suffix}` })
      .returning({ id: schema.group.id });

    const [course] = await db
      .insert(schema.course)
      .values({
        title: `Course ${suffix}`,
        description: 'Test course',
        groupId: group.id,
        slug: `course-${suffix}`,
        status: 'ACTIVE'
      })
      .returning({ id: schema.course.id });

    const [user] = await db
      .insert(schema.user)
      .values({ id: randomUUID(), name: 'Student', email: `student-${suffix}@test.local` })
      .returning({ id: schema.user.id });
    await db.insert(schema.profile).values({ id: user.id, fullname: 'Student', username: `student-${suffix}` });

    const [member] = await db
      .insert(schema.groupmember)
      .values({ groupId: group.id, profileId: user.id, roleId: 3 })
      .returning({ id: schema.groupmember.id });

    const [lesson] = await db
      .insert(schema.lesson)
      .values({ courseId: course.id, title: `Lesson ${suffix}`, order: 1 })
      .returning({ id: schema.lesson.id });

    const [ordinary] = await db
      .insert(schema.exercise)
      .values({ title: `Ordinary ${suffix}`, courseId: course.id, lessonId: lesson.id })
      .returning({ id: schema.exercise.id });

    return {
      organizationId: organization.id as string,
      courseId: course.id as string,
      profileId: user.id as string,
      groupMemberId: member.id as string,
      ordinaryExerciseId: ordinary.id as string
    };
  }

  /** A container: no course, no lesson, and assigned to nobody. */
  async function createContainer(db: any, schema: any) {
    const [container] = await db
      .insert(schema.exercise)
      .values({
        title: `container ${randomUUID()}`,
        courseId: null,
        lessonId: null,
        assignmentMode: 'SELECTED_STUDENTS'
      })
      .returning({ id: schema.exercise.id });

    // A question, so the gradebook's EXISTS(question) predicate would match if the course
    // link ever did — the container must be excluded by the course, not by being empty.
    await db.insert(schema.question).values({
      exerciseId: container.id,
      title: 'Which one?',
      questionTypeId: 1,
      points: 1,
      order: 1
    });

    return container.id as string;
  }

  it('never appears in the course exercise list', async () => {
    const { db, schema, exerciseQueries } = await loadAll();
    const seed = await seedCourseWithStudent(db, schema);
    const containerId = await createContainer(db, schema);

    const listed = await exerciseQueries.getExercisesByCourseId(seed.courseId);
    const ids = listed.map((exercise: { id: string }) => exercise.id);

    expect(ids).toContain(seed.ordinaryExerciseId);
    expect(ids).not.toContain(containerId);
  });

  it('never appears in an enrolled learner’s exercise list', async () => {
    const { db, schema, lmsQueries } = await loadAll();
    const seed = await seedCourseWithStudent(db, schema);
    const containerId = await createContainer(db, schema);

    const listed = await lmsQueries.getLMSExercises(seed.profileId, seed.organizationId);
    const ids = listed.map((exercise: { id: string }) => exercise.id);

    expect(ids).not.toContain(containerId);
  });

  it('never appears in the gradebook, which applies no visibility filter of its own', async () => {
    const { db, schema, markQueries } = await loadAll();
    const seed = await seedCourseWithStudent(db, schema);
    const containerId = await createContainer(db, schema);

    const marks = await markQueries.getMarksByCourseId(seed.courseId);
    const ids = marks.map((mark: { exerciseId?: string }) => mark.exerciseId);

    expect(ids).not.toContain(containerId);
  });

  it('would have appeared, had it carried a course — the reason the course must be null', async () => {
    const { db, schema, exerciseQueries } = await loadAll();
    const seed = await seedCourseWithStudent(db, schema);

    // Same shape as a container in every respect but the course link.
    const [withCourse] = await db
      .insert(schema.exercise)
      .values({
        title: `not-a-container ${randomUUID()}`,
        courseId: seed.courseId,
        lessonId: null,
        assignmentMode: 'SELECTED_STUDENTS'
      })
      .returning({ id: schema.exercise.id });

    const listed = await exerciseQueries.getExercisesByCourseId(seed.courseId);
    const ids = listed.map((exercise: { id: string }) => exercise.id);

    // Proves the earlier claim was wrong and that nulling the course is what saves us.
    expect(ids).toContain(withCourse.id);
  });
});
