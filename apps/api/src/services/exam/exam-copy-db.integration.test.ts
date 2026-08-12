import { randomUUID } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

/**
 * Copying a course exercise into an exam container.
 *
 * This is the only way a container comes into existence, so the whole feature is
 * unreachable without it. The two properties that matter are that the copy is detached —
 * enrolled students must not be able to open the exam paper untimed — and that it carries
 * its own revisions, so editing the original afterwards cannot rewrite a paper already sat.
 */
const integrationVariable = ['RUN', 'DB', 'INTEGRATION'].join('_');
const runDatabaseIntegration = process['env'][integrationVariable] === '1';

describe.runIf(runDatabaseIntegration)('copying an exercise into an exam container', () => {
  async function load() {
    const [{ db }, schema, container] = await Promise.all([
      import('@cio/db/drizzle'),
      import('@cio/db/schema'),
      import('./exam-container')
    ]);
    return { db, schema, container };
  }

  async function seedCourse(db: any, schema: any) {
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
        description: 'copy',
        groupId: group.id,
        slug: `course-${suffix}`,
        status: 'ACTIVE'
      })
      .returning({ id: schema.course.id });

    return course.id as string;
  }

  /** A working exercise on the course, with `count` questions that each carry a revision. */
  async function seedCourseExercise(db: any, schema: any, courseId: string, count = 2) {
    const [exercise] = await db
      .insert(schema.exercise)
      .values({ title: `Bài tập ${randomUUID().slice(0, 8)}`, courseId, lessonId: null })
      .returning({ id: schema.exercise.id });

    for (let index = 0; index < count; index += 1) {
      const [question] = await db
        .insert(schema.question)
        .values({
          exerciseId: exercise.id,
          title: `Câu ${index + 1}`,
          questionTypeId: 1,
          points: index + 1,
          order: index + 1
        })
        .returning({ id: schema.question.id });

      const [revision] = await db
        .insert(schema.questionRevision)
        .values({
          questionId: question.id,
          revision: 1,
          definition: {
            schemaVersion: 1,
            blocks: [
              {
                id: `q-${index}`,
                kind: 'interaction',
                interaction: {
                  kind: 'choice',
                  maxScore: index + 1,
                  required: true,
                  prompt: { html: `<p>Câu ${index + 1}</p>`, format: 'html' },
                  config: {
                    cardinality: 'single',
                    presentation: 'list',
                    options: [
                      { id: `q-${index}-a`, html: '<p>A</p>' },
                      { id: `q-${index}-b`, html: '<p>B</p>' }
                    ],
                    correctOptionIds: [`q-${index}-a`]
                  }
                }
              }
            ],
            feedback: []
          },
          contentHash: randomUUID()
        })
        .returning({ id: schema.questionRevision.id });

      await db
        .update(schema.question)
        .set({ currentRevisionId: revision.id })
        .where(eq(schema.question.id, question.id));
    }

    return exercise.id as string;
  }

  it('produces a detached container the exam machinery accepts', async () => {
    const { db, schema, container } = await load();
    const courseId = await seedCourse(db, schema);
    const sourceId = await seedCourseExercise(db, schema, courseId);

    const copy = await container.copyExerciseIntoContainer(sourceId, courseId, db);

    // Detached on both columns: the course exercise list, the learner list and the
    // gradebook all match on one or the other.
    const [row] = await db
      .select({ courseId: schema.exercise.courseId, lessonId: schema.exercise.lessonId })
      .from(schema.exercise)
      .where(eq(schema.exercise.id, copy.id));
    expect(row.courseId).toBeNull();
    expect(row.lessonId).toBeNull();

    await expect(container.assertIsContainer(copy.id, db)).resolves.toBeUndefined();

    const frozen = await container.freezeExamPaper(copy.id, db);
    expect(frozen.questions).toHaveLength(2);
    expect(frozen.questions.map((question) => question.points)).toEqual([1, 2]);
  });

  it('carries its own revisions, so editing the original never changes the copy', async () => {
    const { db, schema, container } = await load();
    const courseId = await seedCourse(db, schema);
    const sourceId = await seedCourseExercise(db, schema, courseId, 1);

    const copy = await container.copyExerciseIntoContainer(sourceId, courseId, db);
    const before = await container.freezeExamPaper(copy.id, db);

    // Edit the source the way an author would: a new revision, promoted to current.
    const [sourceQuestion] = await db
      .select({ id: schema.question.id })
      .from(schema.question)
      .where(eq(schema.question.exerciseId, sourceId));
    const [rewritten] = await db
      .insert(schema.questionRevision)
      .values({
        questionId: sourceQuestion.id,
        revision: 2,
        definition: { schemaVersion: 1, blocks: [], feedback: [] },
        contentHash: randomUUID()
      })
      .returning({ id: schema.questionRevision.id });
    await db
      .update(schema.question)
      .set({ currentRevisionId: rewritten.id })
      .where(eq(schema.question.id, sourceQuestion.id));

    const after = await container.freezeExamPaper(copy.id, db);
    expect(after.questions[0].questionRevisionId).toBe(before.questions[0].questionRevisionId);
    expect(after.questions[0].definition).toEqual(before.questions[0].definition);
  });

  it('refuses an exercise belonging to another course', async () => {
    const { db, schema, container } = await load();
    const courseId = await seedCourse(db, schema);
    const otherCourseId = await seedCourse(db, schema);
    const sourceId = await seedCourseExercise(db, schema, otherCourseId);

    await expect(container.copyExerciseIntoContainer(sourceId, courseId, db)).rejects.toThrow(
      /belongs to another course/
    );
  });

  it('refuses an exercise with no questions rather than making an empty paper', async () => {
    const { db, schema, container } = await load();
    const courseId = await seedCourse(db, schema);
    const [empty] = await db
      .insert(schema.exercise)
      .values({ title: 'Bài tập rỗng', courseId, lessonId: null })
      .returning({ id: schema.exercise.id });

    await expect(container.copyExerciseIntoContainer(empty.id, courseId, db)).rejects.toThrow(/no questions/);
  });

  it('leaves no container behind when a question cannot be copied', async () => {
    const { db, schema, container } = await load();
    const courseId = await seedCourse(db, schema);
    const sourceId = await seedCourseExercise(db, schema, courseId, 1);

    // A question with no canonical revision cannot be delivered or graded. The copy must
    // fail whole: a half-copied paper is worse than none, because it looks complete.
    await db.insert(schema.question).values({
      exerciseId: sourceId,
      title: 'Câu chưa có bản chốt',
      questionTypeId: 1,
      points: 1,
      order: 99
    });

    const [source] = await db
      .select({ title: schema.exercise.title })
      .from(schema.exercise)
      .where(eq(schema.exercise.id, sourceId));

    await expect(container.copyExerciseIntoContainer(sourceId, courseId, db)).rejects.toThrow(/canonical revision/);

    // Matched on this source's own title rather than counting every container in the
    // database: other tests create containers concurrently, and a count would measure them.
    const leftovers = await db
      .select({ id: schema.exercise.id })
      .from(schema.exercise)
      .where(
        and(isNull(schema.exercise.courseId), isNull(schema.exercise.lessonId), eq(schema.exercise.title, source.title))
      );
    expect(leftovers).toHaveLength(0);
  });

  it('offers the course its own exercises to copy, with their question counts', async () => {
    const { db, schema, container } = await load();
    const courseId = await seedCourse(db, schema);
    const sourceId = await seedCourseExercise(db, schema, courseId, 3);

    const offered = await container.listCopyableExercisesService(courseId, db);
    const row = offered.find((exercise) => exercise.id === sourceId);

    expect(row?.questionCount).toBe(3);

    // The copy is not itself offered as a source: it belongs to no course.
    const copy = await container.copyExerciseIntoContainer(sourceId, courseId, db);
    const again = await container.listCopyableExercisesService(courseId, db);
    expect(again.some((exercise) => exercise.id === copy.id)).toBe(false);
  });
});
