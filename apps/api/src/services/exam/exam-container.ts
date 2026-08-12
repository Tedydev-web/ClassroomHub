import { AppError, ErrorCodes } from '@api/utils/errors';
import { db } from '@cio/db/drizzle';
import * as schema from '@cio/db/schema';
import { getQuestionTypeById, isExerciseAutoGradable } from '@cio/question-types';
import { and, desc, eq, isNull } from 'drizzle-orm';

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

export async function createExamContainer(title: string, dbClient = db): Promise<string> {
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
  const questions = await dbClient
    .select({
      id: schema.question.id,
      title: schema.question.title,
      order: schema.question.order,
      questionTypeId: schema.question.questionTypeId
    })
    .from(schema.question)
    .where(and(eq(schema.question.exerciseId, exerciseId), isNull(schema.question.archivedAt)));

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

  for (const question of questions) {
    const kind = getQuestionTypeById(question.questionTypeId)?.label ?? `type ${question.questionTypeId}`;
    countsByKind[kind] = (countsByKind[kind] ?? 0) + 1;

    const bucket = optionsByQuestion.get(question.id) ?? [];
    optionCounts.push({ questionId: question.id, order: question.order ?? 0, optionCount: bucket.length });

    const meta = getQuestionTypeById(question.questionTypeId);
    if (meta?.autoGradable && bucket.length > 0 && !bucket.some((option) => option.isCorrect === true)) {
      questionsWithoutAnswerKey.push({
        questionId: question.id,
        order: question.order ?? 0,
        title: question.title ?? ''
      });
    }
  }

  return {
    questionCount: questions.length,
    countsByKind,
    optionCounts: optionCounts.sort((a, b) => a.order - b.order),
    questionsWithoutAnswerKey: questionsWithoutAnswerKey.sort((a, b) => a.order - b.order),
    autoGradable: isExerciseAutoGradable(questions.map((question) => question.questionTypeId))
  };
}

/**
 * Freezes the paper onto the exam. Everything later — what a sitter is served, which
 * revision an answer is pinned to, what grading reads — rests on this having happened, so
 * an exam may not leave `draft` without it.
 *
 * The live rows are read here, once, and never again for delivery.
 */
export async function freezeExamPaper(exerciseId: string, dbClient = db): Promise<ExamPaperSnapshot> {
  const questions = await dbClient
    .select({
      id: schema.question.id,
      order: schema.question.order,
      points: schema.question.points,
      currentRevisionId: schema.question.currentRevisionId
    })
    .from(schema.question)
    .where(and(eq(schema.question.exerciseId, exerciseId), isNull(schema.question.archivedAt)));

  if (questions.length === 0) {
    throw new AppError('This paper has no questions to freeze', ErrorCodes.VALIDATION_ERROR, 400);
  }

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
      order: question.order ?? 0,
      points: Number(question.points ?? 0),
      definition: revision.definition as ExamPaperQuestionSnapshot['definition']
    });
  }

  return {
    frozenAt: new Date().toISOString(),
    questions: frozen.sort((a, b) => a.order - b.order)
  };
}

/**
 * Containers an exam may be built from: exercises carrying neither a course nor a lesson,
 * which is what the `.docx` import produces and what a duplicated exercise becomes.
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
