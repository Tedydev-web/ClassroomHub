import * as schema from '@db/schema';

import type { TNewQuestionAnswer, TNewSubmission, TQuestionAnswer, TSubmission } from '@db/types';
import { and, count, db, desc, eq, inArray, sql } from '@db/drizzle';
import type { DbOrTxClient } from '@db/drizzle';

/**
 * Gets a submission by ID
 * @param submissionId Submission ID
 * @returns Submission or null
 */
export async function getSubmissionById(submissionId: string): Promise<TSubmission | null> {
  try {
    const [submission] = await db
      .select()
      .from(schema.submission)
      .where(eq(schema.submission.id, submissionId))
      .limit(1);
    return submission || null;
  } catch (error) {
    console.error('getSubmissionById error:', error);
    throw new Error(
      `Failed to get submission by ID "${submissionId}": ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

export async function lockCourseSubmission(
  courseId: string,
  submissionId: string,
  dbClient: DbOrTxClient
): Promise<TSubmission | null> {
  try {
    await dbClient.execute(
      sql`SELECT ${schema.submission.id}
          FROM ${schema.submission}
          WHERE ${schema.submission.id} = ${submissionId}
            AND ${schema.submission.courseId} = ${courseId}
          FOR UPDATE`
    );

    const [submission] = await dbClient
      .select()
      .from(schema.submission)
      .where(and(eq(schema.submission.id, submissionId), eq(schema.submission.courseId, courseId)))
      .limit(1);

    return submission ?? null;
  } catch (error) {
    console.error('lockCourseSubmission error:', error);
    throw new Error(
      `Failed to lock submission "${submissionId}": ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

export async function hasSubmission(
  exerciseId: string,
  submittedBy: string,
  dbClient: DbOrTxClient = db
): Promise<boolean> {
  try {
    const [result] = await dbClient
      .select({ total: count() })
      .from(schema.submission)
      .where(and(eq(schema.submission.exerciseId, exerciseId), eq(schema.submission.submittedBy, submittedBy)))
      .limit(1);

    return (result?.total ?? 0) > 0;
  } catch (error) {
    console.error('hasSubmission error:', error);
    throw new Error(
      `Failed to check submission existence: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

export async function getSubmissionByIdempotencyKey(
  exerciseId: string,
  submittedBy: string,
  idempotencyKey: string,
  dbClient: DbOrTxClient = db
): Promise<TSubmission | null> {
  try {
    const [submission] = await dbClient
      .select()
      .from(schema.submission)
      .where(
        and(
          eq(schema.submission.exerciseId, exerciseId),
          eq(schema.submission.submittedBy, submittedBy),
          eq(schema.submission.idempotencyKey, idempotencyKey)
        )
      )
      .limit(1);

    return submission ?? null;
  } catch (error) {
    console.error('getSubmissionByIdempotencyKey error:', error);
    throw new Error(
      `Failed to get submission by idempotency key: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Gets submissions by course ID with full related data (answers, profile, etc.)
 * @param courseId Course ID
 * @param exerciseId Optional exercise ID filter
 * @param submittedBy Optional group member ID filter
 * @returns Array of submissions with exercise, groupmember, profile, and answers
 */
export async function getSubmissionsByCourseIdWithDetails(courseId: string, exerciseId?: string, submittedBy?: string) {
  try {
    // Build conditions
    const conditions = [eq(schema.submission.courseId, courseId)];

    if (exerciseId) {
      conditions.push(eq(schema.submission.exerciseId, exerciseId));
    }

    if (submittedBy) {
      conditions.push(eq(schema.submission.submittedBy, submittedBy));
    }

    // Get submissions with relations
    const submissions = await db
      .select({
        submission: schema.submission,
        groupmember: schema.groupmember,
        profile: schema.profile
      })
      .from(schema.submission)
      .leftJoin(schema.groupmember, eq(schema.submission.submittedBy, schema.groupmember.id))
      .leftJoin(schema.profile, eq(schema.groupmember.profileId, schema.profile.id))
      .where(and(...conditions));

    // Get all question answers for these submissions
    const submissionIds = submissions.map((s) => s.submission.id);
    const questionAnswers =
      submissionIds.length > 0
        ? await db
            .select()
            .from(schema.questionAnswer)
            .where(inArray(schema.questionAnswer.submissionId, submissionIds))
        : [];
    const answeredQuestionIds = [...new Set(questionAnswers.map((answer) => answer.questionId))];
    const answeredQuestions =
      answeredQuestionIds.length > 0
        ? await db
            .select({
              id: schema.question.id,
              title: schema.question.title,
              order: schema.question.order,
              exerciseSectionId: schema.question.exerciseSectionId,
              archivedAt: schema.question.archivedAt
            })
            .from(schema.question)
            .where(inArray(schema.question.id, answeredQuestionIds))
        : [];
    const answeredQuestionById = new Map(answeredQuestions.map((question) => [question.id, question]));

    // Group data by submission
    const result = submissions.map((row) => {
      const submissionAnswers = questionAnswers
        .filter((answer) => answer.submissionId === row.submission.id)
        .map((answer) => {
          const currentQuestion = answeredQuestionById.get(answer.questionId) ?? null;
          const attemptedQuestion =
            typeof answer.attemptedQuestionTitle === 'string'
              ? {
                  id: answer.questionId,
                  title: answer.attemptedQuestionTitle,
                  order: answer.attemptedQuestionOrder,
                  exerciseSectionId: answer.attemptedExerciseSectionId,
                  archivedAt: currentQuestion?.archivedAt ?? null
                }
              : currentQuestion;

          return { ...answer, attemptedQuestion };
        });

      return {
        ...row.submission,
        groupmember: row.groupmember
          ? {
              ...row.groupmember,
              profile: row.profile
            }
          : null,
        answers: submissionAnswers
      };
    });

    return result;
  } catch (error) {
    console.error('getSubmissionsByCourseIdWithDetails error:', error);
    throw new Error(
      `Failed to get submissions by course ID with details "${courseId}": ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Gets submissions for grading with all related data
 * @param courseId Course ID
 * @returns Array of submissions with exercise, lesson, groupmember, profile, questions, and answers
 */
export type CourseSubmissionsPageFilters = {
  exerciseId?: string;
  memberId?: string;
  gradingState?: string;
};

/** Returns one page of a course's submissions, newest first and without answers, plus the total matching the filters. */
export async function getCourseSubmissionsPage(
  courseId: string,
  filters: CourseSubmissionsPageFilters,
  paging: { page: number; limit: number }
) {
  try {
    const where = and(
      eq(schema.submission.courseId, courseId),
      filters.exerciseId ? eq(schema.submission.exerciseId, filters.exerciseId) : undefined,
      filters.memberId ? eq(schema.submission.submittedBy, filters.memberId) : undefined,
      filters.gradingState ? eq(schema.submission.gradingState, filters.gradingState) : undefined
    );

    const [items, [totalRow]] = await Promise.all([
      db
        .select({
          submission: schema.submission,
          exerciseTitle: schema.exercise.title,
          exerciseDueBy: schema.exercise.dueBy,
          student: {
            id: schema.profile.id,
            fullname: schema.profile.fullname,
            email: schema.profile.email,
            avatarUrl: schema.profile.avatarUrl
          }
        })
        .from(schema.submission)
        .innerJoin(schema.exercise, eq(schema.submission.exerciseId, schema.exercise.id))
        .leftJoin(schema.groupmember, eq(schema.submission.submittedBy, schema.groupmember.id))
        .leftJoin(schema.profile, eq(schema.groupmember.profileId, schema.profile.id))
        .where(where)
        .orderBy(desc(schema.submission.createdAt), desc(schema.submission.id))
        .limit(paging.limit)
        .offset((paging.page - 1) * paging.limit),
      db
        .select({ total: count() })
        .from(schema.submission)
        .innerJoin(schema.exercise, eq(schema.submission.exerciseId, schema.exercise.id))
        .where(where)
    ]);

    return { items, total: totalRow?.total ?? 0 };
  } catch (error) {
    console.error('getCourseSubmissionsPage error:', error);
    throw new Error(
      `Failed to get submissions page for course ID "${courseId}": ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

export async function getSubmissionsForGrading(courseId: string) {
  try {
    // First, get all submissions with basic relations
    const submissions = await db
      .select({
        submission: schema.submission,
        exercise: schema.exercise,
        lesson: schema.lesson,
        groupmember: schema.groupmember,
        profile: schema.profile
      })
      .from(schema.submission)
      .innerJoin(schema.exercise, eq(schema.submission.exerciseId, schema.exercise.id))
      .leftJoin(schema.lesson, eq(schema.exercise.lessonId, schema.lesson.id))
      .leftJoin(schema.groupmember, eq(schema.submission.submittedBy, schema.groupmember.id))
      .leftJoin(schema.profile, eq(schema.groupmember.profileId, schema.profile.id))
      .where(eq(schema.submission.courseId, courseId));

    // Get all question answers for these submissions
    const submissionIds = submissions.map((s) => s.submission.id);
    const questionAnswers =
      submissionIds.length > 0
        ? await db
            .select()
            .from(schema.questionAnswer)
            .where(inArray(schema.questionAnswer.submissionId, submissionIds))
        : [];

    // Get all questions for the exercises
    const exerciseIds = [...new Set(submissions.map((s) => s.exercise.id))];
    const questions =
      exerciseIds.length > 0
        ? await db.select().from(schema.question).where(inArray(schema.question.exerciseId, exerciseIds))
        : [];

    // Get all options for the questions
    const questionIds = [...new Set(questions.map((q) => q.id))];
    const options =
      questionIds.length > 0
        ? await db.select().from(schema.option).where(inArray(schema.option.questionId, questionIds))
        : [];

    // Group data by submission
    const result = submissions.map((row) => {
      const submissionAnswers = questionAnswers.filter((qa) => qa.submissionId === row.submission.id);
      const exerciseQuestions = questions.filter((q) => q.exerciseId === row.exercise.id);
      const questionsWithOptions = exerciseQuestions.map((q) => ({
        ...q,
        options: options.filter((o) => o.questionId === q.id)
      }));

      return {
        ...row.submission,
        exercise: {
          ...row.exercise,
          questions: questionsWithOptions
        },
        lesson: row.lesson,
        groupmember: row.groupmember
          ? {
              ...row.groupmember,
              profile: row.profile
            }
          : null,
        answers: submissionAnswers
      };
    });

    return result;
  } catch (error) {
    console.error('getSubmissionsForGrading error:', error);
    throw new Error(
      `Failed to get submissions for grading "${courseId}": ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/** Returns the ids among `questionIds` that at least one student has answered. */
export async function getAnsweredQuestionIds(questionIds: number[], dbClient: DbOrTxClient = db): Promise<number[]> {
  if (questionIds.length === 0) return [];

  try {
    const rows = await dbClient
      .selectDistinct({ questionId: schema.questionAnswer.questionId })
      .from(schema.questionAnswer)
      .where(inArray(schema.questionAnswer.questionId, questionIds));

    return rows.map((row) => row.questionId);
  } catch (error) {
    console.error('getAnsweredQuestionIds error:', error);
    throw new Error(`Failed to check question answers: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/** Holds a per-student lock on the exercise until the transaction ends. */
export async function lockSubmissionAttempt(exerciseId: string, submittedBy: string, dbClient: DbOrTxClient) {
  try {
    await dbClient.execute(sql`select pg_advisory_xact_lock(hashtext(${`submission:${exerciseId}:${submittedBy}`}))`);
  } catch (error) {
    console.error('lockSubmissionAttempt error:', error);
    throw new Error(`Failed to lock submission attempt: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Creates a new submission
 * @param data Submission data
 * @returns Created submission
 */
export async function createSubmission(data: TNewSubmission, dbClient: DbOrTxClient = db): Promise<TSubmission> {
  try {
    const [submission] = await dbClient.insert(schema.submission).values(data).returning();
    if (!submission) {
      throw new Error('Failed to create submission');
    }
    return submission;
  } catch (error) {
    console.error('createSubmission error:', error);
    throw new Error(`Failed to create submission: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Updates a submission
 * @param submissionId Submission ID
 * @param data Partial submission data
 * @returns Updated submission or null
 */
export async function updateSubmission(
  courseId: string,
  submissionId: string,
  data: Partial<TSubmission>,
  dbClient: DbOrTxClient = db
): Promise<TSubmission | null> {
  try {
    const [updated] = await dbClient
      .update(schema.submission)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(and(eq(schema.submission.id, submissionId), eq(schema.submission.courseId, courseId)))
      .returning();
    return updated || null;
  } catch (error) {
    console.error('updateSubmission error:', error);
    throw new Error(
      `Failed to update submission "${submissionId}": ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Deletes a submission
 * @param submissionId Submission ID
 * @returns Deleted submission or null
 */
export async function deleteSubmission(
  courseId: string,
  submissionId: string,
  dbClient: DbOrTxClient = db
): Promise<TSubmission | null> {
  try {
    const [deleted] = await dbClient
      .delete(schema.submission)
      .where(and(eq(schema.submission.id, submissionId), eq(schema.submission.courseId, courseId)))
      .returning();
    return deleted || null;
  } catch (error) {
    console.error('deleteSubmission error:', error);
    throw new Error(
      `Failed to delete submission "${submissionId}": ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Gets question answers for a submission
 * @param submissionId Submission ID
 * @returns Array of question answers
 */
export async function getQuestionAnswersBySubmissionId(
  submissionId: string,
  dbClient: DbOrTxClient = db
): Promise<TQuestionAnswer[]> {
  try {
    return dbClient.select().from(schema.questionAnswer).where(eq(schema.questionAnswer.submissionId, submissionId));
  } catch (error) {
    console.error('getQuestionAnswersBySubmissionId error:', error);
    throw new Error(
      `Failed to get question answers for submission "${submissionId}": ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Creates or updates a question answer
 * @param data Question answer data
 * @returns Created or updated question answer
 */
export async function upsertQuestionAnswer(data: TNewQuestionAnswer): Promise<TQuestionAnswer> {
  try {
    // Note: This assumes there's a unique constraint on submissionId + questionId
    // If not, we may need to check existence first and update/insert accordingly
    const [answer] = await db.insert(schema.questionAnswer).values(data).returning();
    if (!answer) {
      throw new Error('Failed to upsert question answer');
    }
    return answer;
  } catch (error) {
    console.error('upsertQuestionAnswer error:', error);
    throw new Error(`Failed to upsert question answer: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function insertQuestionAnswersBatch(
  rows: TNewQuestionAnswer[],
  dbClient: DbOrTxClient = db
): Promise<TQuestionAnswer[]> {
  if (rows.length === 0) {
    return [];
  }

  try {
    return dbClient.insert(schema.questionAnswer).values(rows).returning();
  } catch (error) {
    console.error('insertQuestionAnswersBatch error:', error);
    throw new Error(
      `Failed to insert question answers batch: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Updates a question answer
 * @param submissionId Submission ID
 * @param questionId Question ID
 * @param data Partial question answer data
 * @returns Updated question answer or null
 */
export async function updateQuestionAnswer(
  courseId: string,
  submissionId: string,
  questionId: number,
  data: Partial<TQuestionAnswer>,
  dbClient: DbOrTxClient = db
): Promise<TQuestionAnswer | null> {
  try {
    const [updated] = await dbClient
      .update(schema.questionAnswer)
      .set(data)
      .where(
        and(
          eq(schema.questionAnswer.submissionId, submissionId),
          eq(schema.questionAnswer.questionId, questionId),
          sql`EXISTS (
            SELECT 1
            FROM ${schema.submission}
            WHERE ${schema.submission.id} = ${submissionId}
              AND ${schema.submission.courseId} = ${courseId}
          )`
        )
      )
      .returning();
    return updated || null;
  } catch (error) {
    console.error('updateQuestionAnswer error:', error);
    throw new Error(`Failed to update question answer: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export type TGradesUpdateItem = { questionId: number; points: number };

/**
 * Updates all question answer points and submission total/feedback in a single transaction.
 * Optionally updates statusId and gradingState when provided.
 */
export async function updateSubmissionGrades(
  courseId: string,
  submissionId: string,
  data: {
    answers: TGradesUpdateItem[];
    total: number;
    feedback?: string;
    statusId?: number;
    gradingState?: string;
    gradedBy?: string | null;
  },
  dbClient?: DbOrTxClient
): Promise<TSubmission | null> {
  try {
    const runUpdate = async (client: DbOrTxClient): Promise<TSubmission | null> => {
      if (data.answers.length > 0) {
        const valueRows = data.answers.map((answer) => sql`(${answer.questionId}::bigint, ${answer.points}::numeric)`);
        await client.execute(sql`
          UPDATE question_answer AS qa
          SET score = v.score,
              point = round(v.score)::bigint
          FROM (VALUES ${sql.join(valueRows, sql`, `)}) AS v(question_id, score)
          WHERE qa.submission_id = ${submissionId}
            AND qa.question_id = v.question_id
            AND EXISTS (
              SELECT 1
              FROM submission AS scoped_submission
              WHERE scoped_submission.id = qa.submission_id
                AND scoped_submission.course_id = ${courseId}
            )
        `);
      }

      const submissionData: Partial<TSubmission> = {
        score: data.total,
        total: Math.round(data.total),
        updatedAt: new Date().toISOString()
      };
      if (data.feedback !== undefined) {
        submissionData.feedback = data.feedback;
      }
      if (data.statusId !== undefined) {
        submissionData.statusId = data.statusId;
      }
      if (data.gradingState !== undefined) {
        submissionData.gradingState = data.gradingState;
      }
      if (data.gradedBy !== undefined) {
        submissionData.gradedBy = data.gradedBy;
      }

      const [updated] = await client
        .update(schema.submission)
        .set(submissionData)
        .where(and(eq(schema.submission.id, submissionId), eq(schema.submission.courseId, courseId)))
        .returning();
      return updated || null;
    };

    return dbClient ? await runUpdate(dbClient) : await db.transaction(runUpdate);
  } catch (error) {
    console.error('updateSubmissionGrades error:', error);
    throw new Error(
      `Failed to update submission grades "${submissionId}": ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
