import type { AnswerMatrix } from './exam-answer-matrix';

/**
 * What the class answered, counted per question.
 *
 * The results list says who scored what; this says which question the class fell for and
 * what they fell for instead — the thing a teacher needs before standing in front of the
 * room to go through the paper. A question forty of forty candidates answered correctly is
 * not worth the ten minutes; the one where twenty-six chose B is the lesson.
 *
 * Counted from the same matrix the workbook is built from, so the two can never disagree
 * about what somebody chose.
 */

export type QuestionDistribution = {
  /** The number printed on the paper. */
  position: number;
  /** The key, as the letters the paper shows. Empty when the question has no key. */
  key: string;
  /**
   * Every letter offered, in the paper's order, plus any letter somebody actually chose
   * that the paper no longer offers — an answer a candidate gave is a fact, and dropping it
   * would make the counts add up to less than the class.
   */
  letters: string[];
  /** Letter to how many candidates chose it. */
  counts: Record<string, number>;
  /** Candidates who left it empty. */
  blank: number;
  /** Candidates whose answer matched the key. */
  correct: number;
  /** Candidates counted, which is everyone whose paper is finished. */
  answered: number;
};

/**
 * The letters a question offers, derived from what was chosen and what the key says.
 *
 * The matrix carries letters rather than options, so the offered set is reconstructed from
 * the answers. It is sorted, because A, B, C, D read in that order on paper and any other
 * order would make a teacher hunt.
 */
function lettersOf(chosen: Array<string | null>, key: string): string[] {
  const seen = new Set<string>();

  for (const value of chosen) {
    if (!value) continue;

    // A multi-answer response arrives joined ("AC"); each letter is counted on its own
    // because the question asks about each option, not about the combination.
    for (const letter of value.split('')) seen.add(letter);
  }

  for (const letter of key.split('')) if (letter.trim()) seen.add(letter);

  return [...seen].sort();
}

export function buildAnswerDistribution(matrix: AnswerMatrix): QuestionDistribution[] {
  return matrix.questions.map((question, index) => {
    const chosen = matrix.rows.map((row) => row.chosen[index] ?? null);
    const letters = lettersOf(chosen, question.key);
    const counts: Record<string, number> = Object.fromEntries(letters.map((letter) => [letter, 0]));

    let blank = 0;
    let correct = 0;

    for (const answer of chosen) {
      if (!answer) {
        blank += 1;

        continue;
      }

      for (const letter of answer.split('')) {
        counts[letter] = (counts[letter] ?? 0) + 1;
      }

      // Compared whole rather than letter by letter: a question with two right options is
      // answered correctly only by the candidate who gave both.
      if (question.key && answer === question.key) correct += 1;
    }

    return {
      position: question.position,
      key: question.key,
      letters,
      counts,
      blank,
      correct,
      answered: chosen.length
    };
  });
}
