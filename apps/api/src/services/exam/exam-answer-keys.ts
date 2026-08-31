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
  /**
   * The number the paper prints beside this question, counted across the whole paper.
   *
   * It used to be the item's place in the list, which on a paper of passages is a different
   * number entirely: forty questions across ten passages numbered one to ten here and one to
   * forty everywhere else, so a teacher could not match a row to the question they meant.
   */
  position: number;
  /** The interaction this row is about. An item can hold several; each is one question. */
  interactionId: string;
  points: number;
  promptHtml: string;
  options: ExamAnswerKeyOption[];
  /** The key in force right now: the frozen one, or the last correction to replace it. */
  effectiveKey: string[];
  /**
   * How many options a candidate could pick. On a `single` question the grader compares
   * the key against a response of exactly one option and requires the two to be the same
   * length, so a two-option key marks every candidate wrong. The screen must not offer it.
   */
  cardinality: 'single' | 'multiple';
  /** A key can only be replaced where there is a key to replace. */
  keyFixable: boolean;
  /**
   * How many questions the item holding this one contains.
   *
   * An award is recorded against the item, so on a passage it reaches every question in it.
   * The screen has to be able to say that in numbers rather than leave a teacher to discover
   * it from the results.
   */
  questionsInItem: number;
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
  cardinality?: 'single' | 'multiple';
};

/**
 * One row per question, not per item.
 *
 * An item is a container: a passage holding six questions is one row in the paper snapshot
 * and six numbers on the paper the class sat. Listing items meant every passage appeared
 * once, showing the prompt, the options and the key of its *first* part while the other
 * five were not on the screen at all — and the single letter printed as "the answer" was
 * the answer to a question the teacher could not see they were looking at.
 *
 * Numbering counts every interaction, choice or not, because that is how the paper numbers
 * them. A written answer occupies a number even though it has no key to correct, and
 * skipping it here would shift every number after it.
 */
export function buildAnswerKeyRows(
  questions: Array<{ questionId: number; order: number; points: number; definition: unknown }>,
  kindsByQuestion: Map<number, Set<ExamCorrection['kind']>>
): ExamAnswerKeyQuestion[] {
  const rows: ExamAnswerKeyQuestion[] = [];
  let position = 0;

  for (const question of questions.slice().sort((a, b) => a.order - b.order)) {
    const kinds = kindsByQuestion.get(question.questionId);
    const blocks = getAssessmentInteractionBlocks(question.definition as AssessmentItemDefinition);
    const choiceParts = blocks.filter((block) => block.interaction.kind === 'choice').length;

    for (const block of blocks) {
      position += 1;

      const interaction = block.interaction as { kind?: string; prompt?: { html?: string }; config?: ChoiceConfig };
      const isChoice = interaction.kind === 'choice';
      const config = isChoice ? (interaction.config ?? {}) : {};

      rows.push({
        questionId: question.questionId,
        interactionId: block.id,
        position,
        points: question.points,
        promptHtml: interaction.prompt?.html ?? '',
        options: (config.options ?? []).map((option, index) => ({
          id: option.id,
          label: OPTION_LABELS[index] ?? String(index + 1),
          html: option.html ?? ''
        })),
        effectiveKey: [...(config.correctOptionIds ?? [])],
        cardinality: config.cardinality === 'multiple' ? 'multiple' : 'single',
        keyFixable: isChoice,
        questionsInItem: blocks.length,
        // Still true of the item, and still the reason a key fix is withheld here: the write
        // path replaces the key in every choice part of the item it is given.
        hasSeveralChoiceParts: choiceParts > 1,
        awarded: kinds?.has('award') ?? false,
        corrected: kinds?.has('keyFix') ?? false
      });
    }
  }

  return rows;
}

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

  return buildAnswerKeyRows(corrected.questions, kindsByQuestion);
}
