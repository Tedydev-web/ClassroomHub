import {
  getAssessmentInteractionBlocks,
  scoreAssessmentVerticalSlice,
  validateAssessmentResponseEnvelope,
  type AssessmentItemDefinition
} from '@cio/question-types';

import type { ExamPaperSnapshot } from './exam-paper-serializer';

/**
 * Scoring an attempt against the paper it was given, plus whatever a teacher has since
 * corrected.
 *
 * **Corrections are data, not a sweep.** The obvious implementation — "go and re-score
 * every attempt now" — is wrong here, because lazy finalisation means attempts finalise
 * for days afterwards. An attempt still in progress when a correction lands would either
 * be skipped and later finalised in ignorance of it, or written to while unfinished.
 * Either way, some students end up marked against a key their classmates were not.
 *
 * So grading is defined over the frozen paper **plus** its corrections, and re-scoring is
 * only running that same function again. An attempt finalised next week picks a correction
 * up without anyone remembering to include it, and the snapshot itself stays immutable, so
 * the previous key survives to explain or undo the change.
 */

export type ExamCorrection =
  | { kind: 'award'; questionId: number; by: string; at: string }
  | { kind: 'keyFix'; questionId: number; previousKey: string[]; correctedKey: string[]; by: string; at: string };

export type ManualMarks = Record<number, { score: number; comment?: string }>;

export type StoredExamAnswer = { questionId: number; questionRevisionId: string; answerData: unknown };

export type ExamGradeResult = {
  score: number;
  total: number;
  perQuestion: Array<{ questionId: number; score: number; max: number }>;
  gradingState: 'complete' | 'awaiting_manual' | 'unscoreable';
};

/**
 * Produces the paper as grading should see it. Corrections may only touch the answer key —
 * never the delivered content, which the student has already read.
 */
export function applyCorrections(snapshot: ExamPaperSnapshot, corrections: ExamCorrection[]): ExamPaperSnapshot {
  if (corrections.length === 0) return snapshot;

  const byQuestion = new Map<number, ExamCorrection[]>();
  for (const correction of corrections) {
    byQuestion.set(correction.questionId, [...(byQuestion.get(correction.questionId) ?? []), correction]);
  }

  return {
    ...snapshot,
    questions: snapshot.questions.map((question) => {
      const applicable = byQuestion.get(question.questionId);
      if (!applicable) return question;

      // Deep copy, so the stored snapshot is never mutated in place.
      const definition = JSON.parse(JSON.stringify(question.definition)) as AssessmentItemDefinition;

      for (const correction of applicable) {
        if (correction.kind !== 'keyFix') continue;

        for (const block of getAssessmentInteractionBlocks(definition)) {
          if (block.interaction.kind === 'choice') {
            block.interaction.config.correctOptionIds = [...correction.correctedKey];
          }
        }
      }

      return { ...question, definition };
    })
  };
}

/** Questions the teacher has awarded to everybody, whatever they answered. */
function awardedQuestionIds(corrections: ExamCorrection[]): Set<number> {
  return new Set(corrections.filter((correction) => correction.kind === 'award').map((c) => c.questionId));
}

function isReadableDefinition(definition: AssessmentItemDefinition): boolean {
  try {
    return Array.isArray(definition?.blocks) && getAssessmentInteractionBlocks(definition).length > 0;
  } catch {
    return false;
  }
}

function maxScoreOf(definition: AssessmentItemDefinition): number {
  try {
    return getAssessmentInteractionBlocks(definition).reduce(
      (sum, block) => sum + (block.interaction.maxScore ?? 0),
      0
    );
  } catch {
    return 0;
  }
}

/**
 * The total lives in exactly one place.
 *
 * `scoreSubmissionAnswers` gives a question it cannot auto-score zero and leaves it out of
 * the total entirely, so a paper with hand-marked questions has two sources of marks. If
 * re-scoring called only the automatic scorer it would quietly overwrite a total a teacher
 * had already completed by hand, leaving nothing to signal the loss.
 */
export function gradeAttempt(
  snapshot: ExamPaperSnapshot,
  answers: StoredExamAnswer[],
  corrections: ExamCorrection[],
  manualMarks: ManualMarks = {}
): ExamGradeResult {
  const paper = applyCorrections(snapshot, corrections);
  const awarded = awardedQuestionIds(corrections);
  const answerByQuestion = new Map(answers.map((answer) => [answer.questionId, answer.answerData]));

  const perQuestion: ExamGradeResult['perQuestion'] = [];
  let autoScore = 0;
  let total = 0;
  let awaitingManual = false;

  for (const question of paper.questions) {
    // A definition with no interactions at all is not an empty paper — it is a paper we
    // cannot read, and saying "zero, complete" about it would be a confident lie.
    if (!isReadableDefinition(question.definition)) {
      return { score: 0, total, perQuestion, gradingState: 'unscoreable' };
    }

    const max = maxScoreOf(question.definition);
    total += max;

    if (awarded.has(question.questionId)) {
      autoScore += max;
      perQuestion.push({ questionId: question.questionId, score: max, max });
      continue;
    }

    const response = answerByQuestion.get(question.questionId);
    if (response === undefined) {
      perQuestion.push({ questionId: question.questionId, score: 0, max });
      continue;
    }

    try {
      const validated = validateAssessmentResponseEnvelope(question.definition, response as never);

      if (!validated.success) {
        perQuestion.push({ questionId: question.questionId, score: 0, max });
        continue;
      }

      const scored = scoreAssessmentVerticalSlice(question.definition, validated.data);
      autoScore += scored.autoScore;
      if (scored.manualMaxScore > 0) awaitingManual = true;

      perQuestion.push({ questionId: question.questionId, score: scored.autoScore, max });
    } catch {
      // One unscoreable question must not fail the whole attempt, and one unscoreable
      // attempt must not fail the whole results page.
      return {
        score: 0,
        total,
        perQuestion,
        gradingState: 'unscoreable'
      };
    }
  }

  const manualTotal = Object.values(manualMarks).reduce((sum, mark) => sum + (mark.score ?? 0), 0);
  const markedQuestionIds = new Set(Object.keys(manualMarks).map(Number));
  const stillAwaiting = awaitingManual && paper.questions.some((q) => !markedQuestionIds.has(q.questionId));

  return {
    score: autoScore + manualTotal,
    total,
    perQuestion,
    gradingState: stillAwaiting ? 'awaiting_manual' : 'complete'
  };
}
