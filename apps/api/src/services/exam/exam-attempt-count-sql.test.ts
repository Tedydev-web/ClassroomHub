import { describe, expect, it } from 'vitest';

/**
 * The correlation that tells a teacher whether anybody has sat a paper.
 *
 * It is checked as SQL rather than against a database because the failure it guards was
 * not an error: interpolating columns into a `sql` fragment rendered them unqualified, so
 * `where "exam_id" = "id"` compared an attempt to itself inside the subquery and every
 * exam came back with a count of nought. Nothing threw, and the list read "no one yet"
 * under a paper thirteen people had handed in.
 */
describe('counting the attempts that belong to an exam row', () => {
  it('names the table on both sides of the correlation', async () => {
    const [{ db }, schema, { examAttemptCountForRow }, { eq }] = await Promise.all([
      import('@cio/db/drizzle'),
      import('@cio/db/schema'),
      import('@cio/db/queries/exam/exam'),
      import('drizzle-orm')
    ]);

    const { sql } = db
      .select({
        sat: examAttemptCountForRow(db),
        inProgress: examAttemptCountForRow(db, eq(schema.examAttempt.status, 'in_progress'))
      })
      .from(schema.exam)
      .toSQL();

    expect(sql).toContain('"exam_attempt"."exam_id" = "exam"."id"');
    expect(sql).toContain('"exam_attempt"."status" =');
    // The shape that produced the silent zero.
    expect(sql).not.toContain('where "exam_id" = "id"');
  });
});
