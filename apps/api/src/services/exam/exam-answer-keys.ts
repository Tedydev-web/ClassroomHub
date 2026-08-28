import { AppError, ErrorCodes } from '@api/utils/errors';
import { getExamById } from '@cio/db/queries/exam/exam';
import { getAssessmentInteractionBlocks, type AssessmentItemDefinition } from '@cio/question-types';

import { applyCorrections, type ExamCorrection } from './exam-grading';
import type { ExamPaperSnapshot } from './exam-paper-serializer';
import { requireExamsEnabled } from './exam';

/**
 * The answer key of a frozen paper, as the teacher who has to fix one needs to read it.
 *
 * This deliberately reports the paper as grading sees it — the snapshot with every
 * correction already applied — rather than the snapshot alone. A teacher correcting a key
 * for the second time must see the key currently in force, not the one the paper froze
 * with, or the correction they submit would be measured against the wrong starting point.
 *
 * It is not the same thing as `summariseExamPaperService`, which counts questions in the
 * live container. The container can have moved on since the exam opened; only the snapshot
 * says what the candidates actually sat.
 */

/** A, B, C … then plain numbers, which is how the options are labelled to a candidate. */
const OPTION_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export type ExamAnswerKeyOption = { id: string; label: string; html: string };

export type ExamAnswerKeyQuestion = {
  questionId: number;
  /** Position in delivery order, one-based, which is the number on the candidate's paper. */
  position: number;
  points: number;
  promptHtml: string;
  options: ExamAnswerKeyOption[];
  /** The key in force right now: the frozen one, or the last correction to replace it. */
  effectiveKey: string[];
  /** A key can only be replaced where there is a key to replace. */
  keyFixable: boolean;
  /**
   * Whether more than one part of this question is answered by choosing options. A key fix
   * writes the corrected key into every one of them, so where this is true the teacher is
   * offered the award instead — correcting one part would silently rewrite the others.
   */
  hasSeveralChoiceParts: boolean;
  awarded: boolean;
  corrected: boolean;
};

type ChoiceConfig = {
  options?: Array<{ id: string; html?: string }>;
  correctOptionIds?: string[];
};

export async function listExamAnswerKeysService(examId: string): Promise<ExamAnswerKeyQuestion[]> {
  requireExamsEnabled();

  const exam = await getExamById(examId);
  if (!exam) throw new AppError('Exam not found', ErrorCodes.NOT_FOUND, 404);

  const snapshot = exam.paperSnapshot as ExamPaperSnapshot | null;
  if (!snapshot || !snapshot.questions?.length) {
    throw new AppError('This exam has no frozen paper', ErrorCodes.VALIDATION_ERROR, 409);
  }

  const corrections = (exam.corrections as ExamCorrection[]) ?? [];
  const corrected = applyCorrections(snapshot, corrections);

  const kindsByQuestion = new Map<number, Set<ExamCorrection['kind']>>();
  for (const correction of corrections) {
    const kinds = kindsByQuestion.get(correction.questionId) ?? new Set();
    kinds.add(correction.kind);
    kindsByQuestion.set(correction.questionId, kinds);
  }

  return corrected.questions
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((question, index) => {
      const blocks = getAssessmentInteractionBlocks(question.definition as AssessmentItemDefinition);
      const choiceBlocks = blocks.filter((block) => block.interaction.kind === 'choice');
      const first = choiceBlocks[0]?.interaction as { prompt?: { html?: string }; config?: ChoiceConfig } | undefined;
      const config = first?.config ?? {};

      const kinds = kindsByQuestion.get(question.questionId);

      return {
        questionId: question.questionId,
        position: index + 1,
        points: question.points,
        promptHtml: first?.prompt?.html ?? '',
        options: (config.options ?? []).map((option, position) => ({
          id: option.id,
          label: OPTION_LABELS[position] ?? String(position + 1),
          html: option.html ?? ''
        })),
        effectiveKey: [...(config.correctOptionIds ?? [])],
        keyFixable: choiceBlocks.length > 0,
        hasSeveralChoiceParts: choiceBlocks.length > 1,
        awarded: kinds?.has('award') ?? false,
        corrected: kinds?.has('keyFix') ?? false
      };
    });
}
