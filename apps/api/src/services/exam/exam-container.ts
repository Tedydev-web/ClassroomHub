import { AppError, ErrorCodes } from '@api/utils/errors';
import { db, type DbOrTxClient } from '@cio/db/drizzle';
import * as schema from '@cio/db/schema';
import { getQuestionTypeById, isExerciseAutoGradable } from '@cio/question-types';
import { insertNextQuestionRevision, promoteQuestionCurrentRevision } from '@cio/db/queries/exercise/revision';
import { listExerciseQuestionsInDeliveryOrder } from '@cio/db/queries/exercise/delivery-order';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';

import type { ExamPaperQuestionSnapshot, ExamPaperSnapshot } from './exam-paper-serializer';

/**
 * The question container an exam delivers, and the act of freezing its paper.
 *
 * A container is an ordinary `exercise` row with **both** `courseId` and `lessonId` null.
 * Both matter, and the reason is verified by an integration test rather than argued here:
 * the course exercise list, the learner list and the gradebook all match on the course, so
 * a container carrying one would appear in all three — and with the default assignment
 * mode, as an ordinary exercise a student could open and answer before the exam opened,
 * with no clock at all.
 *
 * `SELECTED_STUDENTS` with no assignees is a second line of defence, not the fix.
 */

export async function createExamContainer(title: string, dbClient: DbOrTxClient = db): Promise<string> {
  const [container] = await dbClient
    .insert(schema.exercise)
    .values({
      title,
      courseId: null,
      lessonId: null,
      assignmentMode: 'SELECTED_STUDENTS'
    })
    .returning({ id: schema.exercise.id });

  return container.id;
}

/** Refuses anything that is not shaped like a container, before an exam is tied to it. */
export async function assertIsContainer(exerciseId: string, dbClient = db): Promise<void> {
  const [exercise] = await dbClient
    .select({ courseId: schema.exercise.courseId, lessonId: schema.exercise.lessonId })
    .from(schema.exercise)
    .where(eq(schema.exercise.id, exerciseId))
    .limit(1);

  if (!exercise) {
    throw new AppError('That question container does not exist', ErrorCodes.NOT_FOUND, 404);
  }

  if (exercise.courseId !== null || exercise.lessonId !== null) {
    throw new AppError(
      'An exam must deliver a detached container, not a working exercise — otherwise enrolled students could answer it without a clock',
      ErrorCodes.VALIDATION_ERROR,
      400
    );
  }
}

export type ExamPaperSummary = {
  questionCount: number;
  countsByKind: Record<string, number>;
  optionCounts: Array<{ questionId: number; order: number; optionCount: number }>;
  /** The check our own import needed: a question nobody can score. */
  questionsWithoutAnswerKey: Array<{ questionId: number; order: number; title: string }>;
  autoGradable: boolean;
};

/**
 * What the teacher is shown before sending the link.
 *
 * Azota reports the same things under `Thông tin đề`, and it is worth more to us than to
 * them: the `.docx` import once produced a paper with seventeen of forty answer keys
 * missing, and a summary shown before the link went out would have caught it in seconds.
 * It reports and refuses nothing — a mirror, not a gate.
 */
export async function summariseContainer(exerciseId: string, dbClient = db): Promise<ExamPaperSummary> {
  const questions = await listExerciseQuestionsInDeliveryOrder(exerciseId, dbClient);

  const options = await dbClient
    .select({ questionId: schema.option.questionId, isCorrect: schema.option.isCorrect })
    .from(schema.option)
    .innerJoin(schema.question, eq(schema.question.id, schema.option.questionId))
    .where(eq(schema.question.exerciseId, exerciseId));

  const optionsByQuestion = new Map<number, Array<{ isCorrect: boolean | null }>>();
  for (const option of options) {
    const bucket = optionsByQuestion.get(option.questionId) ?? [];
    bucket.push({ isCorrect: option.isCorrect });
    optionsByQuestion.set(option.questionId, bucket);
  }

  const countsByKind: Record<string, number> = {};
  const optionCounts: ExamPaperSummary['optionCounts'] = [];
  const questionsWithoutAnswerKey: ExamPaperSummary['questionsWithoutAnswerKey'] = [];

  // `questions` already arrives in delivery order. The reported position is derived from
  // that rather than from the stored `order`, which is section-relative and can repeat.
  // It counts from one because the teacher reads it as a question number.
  for (const [index, question] of questions.entries()) {
    const position = index + 1;
    const kind = getQuestionTypeById(question.questionTypeId)?.label ?? `type ${question.questionTypeId}`;
    countsByKind[kind] = (countsByKind[kind] ?? 0) + 1;

    const bucket = optionsByQuestion.get(question.id) ?? [];
    optionCounts.push({ questionId: question.id, order: position, optionCount: bucket.length });

    const meta = getQuestionTypeById(question.questionTypeId);
    if (meta?.autoGradable && bucket.length > 0 && !bucket.some((option) => option.isCorrect === true)) {
      questionsWithoutAnswerKey.push({
        questionId: question.id,
        order: position,
        title: question.title ?? ''
      });
    }
  }

  return {
    questionCount: questions.length,
    countsByKind,
    optionCounts,
    questionsWithoutAnswerKey,
    autoGradable: isExerciseAutoGradable(questions.map((question) => question.questionTypeId))
  };
}

/**
 * A container's `order` values must be unique, because they are the only thing that puts
 * its questions in sequence — it is a flat delivery artifact with no sections to
 * disambiguate a tie. `copyExerciseIntoContainer` produces `0..n`; a hand-built container
 * numbering from one is equally deliverable, so the rule is uniqueness rather than any
 * particular base.
 *
 * It is checked at the last moment before a paper is served rather than trusted from
 * upstream, because that is the moment a mistake stops being recoverable: once a snapshot
 * is frozen, students sit whatever it says. Failing loudly here is the difference between
 * a teacher seeing an error and a class sitting a scrambled paper.
 */
function assertDeliveryOrderIsUnambiguous(questions: Array<{ order: number | null }>): void {
  const seen = new Set<number>();

  for (const question of questions) {
    const order = question.order;
    if (order === null || !Number.isInteger(order)) {
      throw new AppError(
        'This paper cannot be frozen: a question carries no order, so its position is undefined',
        ErrorCodes.VALIDATION_ERROR,
        400
      );
    }
    if (seen.has(order)) {
      throw new AppError(
        `This paper cannot be frozen: two questions share order ${order}, so their sequence is undefined`,
        ErrorCodes.VALIDATION_ERROR,
        400
      );
    }
    seen.add(order);
  }
}

/**
 * Freezes the paper onto the exam. Everything later — what a sitter is served, which
 * revision an answer is pinned to, what grading reads — rests on this having happened, so
 * an exam may not leave `draft` without it.
 *
 * The live rows are read here, once, and never again for delivery.
 */
export async function freezeExamPaper(exerciseId: string, dbClient = db): Promise<ExamPaperSnapshot> {
  const questions = await listExerciseQuestionsInDeliveryOrder(exerciseId, dbClient);

  if (questions.length === 0) {
    throw new AppError('This paper has no questions to freeze', ErrorCodes.VALIDATION_ERROR, 400);
  }

  assertDeliveryOrderIsUnambiguous(questions);

  const frozen: ExamPaperQuestionSnapshot[] = [];

  for (const question of questions) {
    if (!question.currentRevisionId) {
      throw new AppError(
        `Question ${question.id} has no canonical revision, so it cannot be delivered or graded`,
        ErrorCodes.VALIDATION_ERROR,
        400
      );
    }

    const [revision] = await dbClient
      .select({ id: schema.questionRevision.id, definition: schema.questionRevision.definition })
      .from(schema.questionRevision)
      .where(eq(schema.questionRevision.id, question.currentRevisionId))
      .limit(1);

    if (!revision) {
      throw new AppError(`Question ${question.id} points at a revision that is gone`, ErrorCodes.NOT_FOUND, 404);
    }

    frozen.push({
      questionId: question.id,
      questionRevisionId: revision.id,
      // The delivery position, not the stored `order`. A snapshot is the paper as sat,
      // so its numbering has to be dense and total — the section-relative `order` is
      // neither, and everything downstream sorts on this field.
      order: frozen.length + 1,
      points: Number(question.points ?? 0),
      definition: revision.definition as ExamPaperQuestionSnapshot['definition']
    });
  }

  return {
    frozenAt: new Date().toISOString(),
    questions: frozen
  };
}

/**
 * Containers an exam may be built from: exercises carrying neither a course nor a lesson,
 * which is what `copyExerciseIntoContainer` produces.
 *
 * A working exercise is deliberately excluded. Delivering one as an exam would let every
 * enrolled student open the same questions without a clock, which is the leak the whole
 * container idea exists to prevent.
 */
export async function listAvailableContainersService(courseId: string, dbClient = db) {
  const containers = await dbClient
    .select({ id: schema.exercise.id, title: schema.exercise.title, createdAt: schema.exercise.createdAt })
    .from(schema.exercise)
    .where(and(isNull(schema.exercise.courseId), isNull(schema.exercise.lessonId)))
    .orderBy(desc(schema.exercise.createdAt))
    .limit(100);

  // `courseId` is accepted for authorisation only — the middleware has already checked the
  // caller may act on this course. Containers themselves belong to no course by design.
  void courseId;

  return containers;
}

/**
 * The exercises of this course, offered as sources to copy a paper from.
 *
 * Both attachments count: an exercise may hang off the course directly or off one of its
 * lessons, and a teacher who built the paper inside a lesson would otherwise be told the
 * course has nothing to copy.
 */
export async function listCopyableExercisesService(courseId: string, dbClient = db) {
  return dbClient
    .select({
      id: schema.exercise.id,
      title: schema.exercise.title,
      questionCount:
        sql<number>`count(${schema.question.id}) filter (where ${schema.question.archivedAt} is null)`.mapWith(Number)
    })
    .from(schema.exercise)
    .leftJoin(schema.lesson, eq(schema.lesson.id, schema.exercise.lessonId))
    .leftJoin(schema.question, eq(schema.question.exerciseId, schema.exercise.id))
    .where(or(eq(schema.exercise.courseId, courseId), eq(schema.lesson.courseId, courseId)))
    .groupBy(schema.exercise.id, schema.exercise.title, schema.exercise.createdAt)
    .orderBy(desc(schema.exercise.createdAt))
    .limit(100);
}

/**
 * Copies a working exercise into a detached container, so an exam can deliver it.
 *
 * A copy rather than a reference, for two independent reasons. The exam must not deliver
 * the very rows enrolled students can already open untimed — that is the leak the
 * container exists to prevent. And the teacher keeps editing the course exercise after the
 * exam is built; a reference would let today's edit rewrite a paper sat last week.
 *
 * Each copied question gets its own revision carrying the source definition verbatim.
 * The definition is self-contained — its option ids are internal strings, not row ids — so
 * copying it is exact, and it is what `freezeExamPaper` will pin the exam to.
 */
export async function copyExerciseIntoContainer(
  sourceExerciseId: string,
  courseId: string,
  dbClient = db
): Promise<{ id: string; title: string }> {
  const [source] = await dbClient
    .select({
      title: schema.exercise.title,
      courseId: schema.exercise.courseId,
      lessonCourseId: schema.lesson.courseId
    })
    .from(schema.exercise)
    .leftJoin(schema.lesson, eq(schema.lesson.id, schema.exercise.lessonId))
    .where(eq(schema.exercise.id, sourceExerciseId))
    .limit(1);

  if (!source) {
    throw new AppError('That exercise does not exist', ErrorCodes.NOT_FOUND, 404);
  }

  // The middleware authorised the caller against this course, not against an arbitrary
  // exercise id in the request body. Without this check a teacher of any one course could
  // copy the paper of any other.
  if (source.courseId !== courseId && source.lessonCourseId !== courseId) {
    throw new AppError('That exercise belongs to another course', ErrorCodes.FORBIDDEN, 403);
  }

  return copyQuestionsIntoNewContainer(sourceExerciseId, source.title, dbClient);
}

/**
 * Copies every question of one exercise or container into a brand new container.
 *
 * Separate from the caller above because the two differ only in who is allowed to ask.
 * Copying a course exercise is checked against the course; copying a container is checked
 * against the exam that owns it, since a container belongs to no course — it has no
 * `courseId` at all, which is what makes it a container.
 *
 * Questions are copied, never shared. Two exams pointing at one container would mean
 * editing the paper of the second silently rewrote what the first freezes next time it
 * opens.
 */
export async function copyQuestionsIntoNewContainer(
  sourceExerciseId: string,
  title: string,
  dbClient = db
): Promise<{ id: string; title: string }> {
  const questions = await listExerciseQuestionsInDeliveryOrder(sourceExerciseId, dbClient);

  if (questions.length === 0) {
    throw new AppError('That exercise has no questions to copy', ErrorCodes.VALIDATION_ERROR, 400);
  }

  return dbClient.transaction(async (tx) => {
    const containerId = await createExamContainer(title, tx);

    // The source's `order` is section-relative and repeats across sections; a container
    // has no sections to disambiguate it. Renumbering densely here is what lets every
    // later read sort on `order` alone and still be right.
    for (const [position, question] of questions.entries()) {
      if (!question.currentRevisionId) {
        throw new AppError(
          `"${question.title}" has no canonical revision, so it cannot be delivered or graded`,
          ErrorCodes.VALIDATION_ERROR,
          400
        );
      }

      const [revision] = await tx
        .select({ definition: schema.questionRevision.definition, contentHash: schema.questionRevision.contentHash })
        .from(schema.questionRevision)
        .where(eq(schema.questionRevision.id, question.currentRevisionId))
        .limit(1);

      if (!revision) {
        throw new AppError(`"${question.title}" points at a revision that is gone`, ErrorCodes.NOT_FOUND, 404);
      }

      const [copied] = await tx
        .insert(schema.question)
        .values({
          exerciseId: containerId,
          title: question.title,
          questionTypeId: question.questionTypeId,
          points: question.points,
          order: position,
          settings: question.settings,
          // Sections are not copied: nothing in delivery, grading or the paper summary
          // reads them, and an exam is sat as one flat paper.
          exerciseSectionId: null
        })
        .returning({ id: schema.question.id });

      const inserted = await insertNextQuestionRevision(
        { questionId: copied.id, definition: revision.definition, contentHash: revision.contentHash },
        tx
      );
      await promoteQuestionCurrentRevision(copied.id, inserted.id, Number(question.points ?? 0), tx);
    }

    return { id: containerId, title };
  });
}
