/**
 * Score summation for the student-facing submission review.
 *
 * A submission can carry answers to questions that were archived after the
 * attempt. The review UI only renders the current active question list, so the
 * score numerator must be restricted to that same rendered question-id set —
 * otherwise archived answers inflate the numerator past the displayed maximum
 * (e.g. 5/3). Surfacing the full attempted set (archived questions included)
 * requires the canonical assessment read API, which does not exist yet.
 */

/** Minimal question shape shared by the exercise store and review components. */
export interface RenderedQuestionRef {
  id: string | number;
}

/** Minimal answer shape shared by submission list/review payloads. */
export interface ScoredSubmissionAnswer {
  questionId: number;
  score?: number | string | null;
  point?: number | string | null;
}

/**
 * Sum per-answer scores restricted to the given (rendered) questions.
 * Fractional scores are preserved; answers whose question is not rendered
 * (archived or otherwise absent) are excluded so score never exceeds the
 * rendered maximum.
 */
export function sumAnswerScoresForRenderedQuestions(
  renderedQuestions: ReadonlyArray<RenderedQuestionRef>,
  answers: ReadonlyArray<ScoredSubmissionAnswer> | null | undefined
): number {
  const renderedQuestionIds = new Set<number>();
  for (const question of renderedQuestions) {
    const questionId = Number(question.id);
    if (Number.isFinite(questionId)) renderedQuestionIds.add(questionId);
  }

  return (answers ?? []).reduce((total, answer) => {
    if (!renderedQuestionIds.has(Number(answer.questionId))) return total;

    const answerScore = Number(answer.score ?? answer.point ?? 0);
    return total + (Number.isFinite(answerScore) ? answerScore : 0);
  }, 0);
}
