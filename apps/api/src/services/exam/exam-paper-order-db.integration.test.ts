import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

/**
 * Delivery order across the authoring boundary.
 *
 * `question.order` is unique only within its section, so a paper with several sections
 * carries the same order value several times. Every delivery read therefore has to sort
 * by section first, and a container — which has no sections — has to be renumbered when
 * it is copied. Both of those were once missing, and a forty-question paper reached
 * students as `1-6, 7, 12-16, 17-26, 27-32, 33-40, 8, 9, 10, 11`.
 *
 * The fixture below is that exact shape: several sections whose orders all restart at
 * zero, plus one section of standalone questions that carries orders 0..3.
 */
const integrationVariable = ['RUN', 'DB', 'INTEGRATION'].join('_');
const runDatabaseIntegration = process['env'][integrationVariable] === '1';

describe.runIf(runDatabaseIntegration)('exam paper delivery order', () => {
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
        description: 'order',
        groupId: group.id,
        slug: `course-${suffix}`,
        status: 'ACTIVE'
      })
      .returning({ id: schema.course.id });

    return course.id as string;
  }

  function definition(label: string) {
    return {
      schemaVersion: 1,
      blocks: [
        {
          id: `block-${label}`,
          kind: 'interaction',
          interaction: {
            kind: 'choice',
            maxScore: 1,
            required: true,
            prompt: { html: `<p>${label}</p>`, format: 'html' },
            config: {
              cardinality: 'single',
              presentation: 'list',
              options: [
                { id: `${label}-a`, html: '<p>A</p>' },
                { id: `${label}-b`, html: '<p>B</p>' }
              ],
              correctOptionIds: [`${label}-a`]
            }
          }
        }
      ],
      feedback: []
    };
  }

  /**
   * Builds `sections` as `[{ title, questionLabels }]`. Every section numbers its own
   * questions from zero, which is what the authoring model guarantees and what the
   * delivery reads used to ignore.
   */
  async function seedSectionedExercise(
    db: any,
    schema: any,
    courseId: string,
    sections: Array<{ title: string; labels: string[] }>
  ) {
    const [exercise] = await db
      .insert(schema.exercise)
      .values({ title: `Đề ${randomUUID().slice(0, 8)}`, courseId, lessonId: null })
      .returning({ id: schema.exercise.id });

    for (const [sectionIndex, section] of sections.entries()) {
      const [row] = await db
        .insert(schema.exerciseSection)
        .values({ exerciseId: exercise.id, title: section.title, order: sectionIndex })
        .returning({ id: schema.exerciseSection.id });

      for (const [questionIndex, label] of section.labels.entries()) {
        const [question] = await db
          .insert(schema.question)
          .values({
            exerciseId: exercise.id,
            exerciseSectionId: row.id,
            title: label,
            questionTypeId: 1,
            points: 1,
            // Restarts at zero in every section — the collision the bug rode in on.
            order: questionIndex
          })
          .returning({ id: schema.question.id });

        const [revision] = await db
          .insert(schema.questionRevision)
          .values({
            questionId: question.id,
            revision: 1,
            definition: definition(label),
            contentHash: randomUUID()
          })
          .returning({ id: schema.questionRevision.id });

        await db
          .update(schema.question)
          .set({ currentRevisionId: revision.id })
          .where(eq(schema.question.id, question.id));
      }
    }

    return exercise.id as string;
  }

  /** The six-section shape of the paper that shipped wrong. */
  const SECTIONS = [
    { title: 'Phần 1', labels: ['1-6'] },
    { title: 'Phần 2', labels: ['7', '8', '9', '10', '11'] },
    { title: 'Phần 3', labels: ['12-16'] },
    { title: 'Phần 4', labels: ['17-26'] },
    { title: 'Phần 5', labels: ['27-32'] },
    { title: 'Phần 6', labels: ['33-40'] }
  ];
  const EXPECTED = ['1-6', '7', '8', '9', '10', '11', '12-16', '17-26', '27-32', '33-40'];

  it('copies a multi-section exercise into a densely ordered container', async () => {
    const { db, schema, container } = await load();
    const courseId = await seedCourse(db, schema);
    const sourceId = await seedSectionedExercise(db, schema, courseId, SECTIONS);

    const copy = await container.copyExerciseIntoContainer(sourceId, courseId, db);

    const copied = await db
      .select({ title: schema.question.title, order: schema.question.order })
      .from(schema.question)
      .where(eq(schema.question.exerciseId, copy.id));

    const sorted = copied.slice().sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));
    expect(sorted.map((row: any) => row.title)).toEqual(EXPECTED);

    // Dense and unique: any naive `ORDER BY "order"` on a container is now correct.
    expect(sorted.map((row: any) => row.order)).toEqual(EXPECTED.map((_, index) => index));
  });

  it('freezes the paper in source order with dense positions', async () => {
    const { db, schema, container } = await load();
    const courseId = await seedCourse(db, schema);
    const sourceId = await seedSectionedExercise(db, schema, courseId, SECTIONS);
    const copy = await container.copyExerciseIntoContainer(sourceId, courseId, db);

    const snapshot = await container.freezeExamPaper(copy.id, db);

    expect(snapshot.questions.map((question: any) => question.definition.blocks[0].id)).toEqual(
      EXPECTED.map((label) => `block-${label}`)
    );
    expect(snapshot.questions.map((question: any) => question.order)).toEqual(EXPECTED.map((_, index) => index + 1));
  });

  it('summarises a container in delivery order', async () => {
    const { db, schema, container } = await load();
    const courseId = await seedCourse(db, schema);
    const sourceId = await seedSectionedExercise(db, schema, courseId, SECTIONS);
    const copy = await container.copyExerciseIntoContainer(sourceId, courseId, db);

    const summary = await container.summariseContainer(copy.id, db);

    expect(summary.questionCount).toBe(EXPECTED.length);
    // Reported to the teacher as a question number, so it counts from one.
    expect(summary.optionCounts.map((entry: any) => entry.order)).toEqual(EXPECTED.map((_, index) => index + 1));
  });

  it('refuses to freeze a paper whose questions share an order', async () => {
    const { db, schema, container } = await load();
    const courseId = await seedCourse(db, schema);
    const sourceId = await seedSectionedExercise(db, schema, courseId, SECTIONS);
    const copy = await container.copyExerciseIntoContainer(sourceId, courseId, db);

    // Reproduce the corrupt state the old copy produced: every question at order 0.
    await db.update(schema.question).set({ order: 0 }).where(eq(schema.question.exerciseId, copy.id));

    await expect(container.freezeExamPaper(copy.id, db)).rejects.toThrow(/share order/i);
  });
});
