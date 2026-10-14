import { describe, expect, it } from 'vitest';

import type { ExamSittingPaper, ExamSittingQuestion } from './exam-paper-serializer';
import { shufflePaper } from './exam-paper-shuffle';

function choice(
  questionId: number,
  options: string[],
  presentation: 'list' | 'true_false' = 'list'
): ExamSittingQuestion {
  return {
    questionId,
    questionRevisionId: `rev-${questionId}`,
    order: questionId,
    points: 1,
    definition: {
      schemaVersion: 1,
      blocks: [
        {
          id: `q${questionId}`,
          kind: 'interaction',
          interaction: {
            kind: 'choice',
            prompt: { format: 'html', html: `<p>Question ${questionId}</p>` },
            required: true,
            maxScore: 1,
            config: {
              cardinality: 'single',
              presentation,
              options: options.map((html, index) => ({ id: `q${questionId}-${index}`, html: `<p>${html}</p>` }))
            }
          }
        }
      ]
    }
  };
}

function heading(questionId: number): ExamSittingQuestion {
  return {
    questionId,
    questionRevisionId: `rev-${questionId}`,
    order: questionId,
    points: 0,
    definition: {
      schemaVersion: 1,
      blocks: [{ id: `h${questionId}`, kind: 'content', content: { format: 'html', html: '<h2>Part</h2>' } }]
    }
  };
}

function paperOf(questions: ExamSittingQuestion[]): ExamSittingPaper {
  return { frozenAt: '2026-10-14T00:00:00.000Z', questions };
}

const eight = Array.from({ length: 8 }, (_, index) => choice(index + 1, ['one', 'two', 'three', 'four', 'five']));

function optionIds(question: ExamSittingQuestion): string[] {
  const block = question.definition.blocks[0];
  if (block.kind !== 'interaction' || block.interaction.kind !== 'choice') return [];
  return block.interaction.config.options.map((option) => option.id);
}

describe('shufflePaper', () => {
  it('leaves the paper untouched when neither switch is on', () => {
    const paper = paperOf(eight);

    expect(shufflePaper(paper, 'attempt-a', { questions: false, options: false })).toEqual(paper);
  });

  it('gives one attempt the same order every time it is asked, so a resume does not reshuffle', () => {
    const first = shufflePaper(paperOf(eight), 'attempt-a', { questions: true, options: true });
    const again = shufflePaper(paperOf(eight), 'attempt-a', { questions: true, options: true });

    expect(again).toEqual(first);
  });

  it('gives two attempts different orders', () => {
    const a = shufflePaper(paperOf(eight), 'attempt-a', { questions: true, options: false });
    const b = shufflePaper(paperOf(eight), 'attempt-b', { questions: true, options: false });

    expect(a.questions.map((q) => q.questionId)).not.toEqual(b.questions.map((q) => q.questionId));
  });

  it('keeps every question exactly once and renumbers the order to match the new position', () => {
    const shuffled = shufflePaper(paperOf(eight), 'attempt-a', { questions: true, options: false });

    expect(shuffled.questions.map((q) => q.questionId).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(shuffled.questions.map((q) => q.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('keeps a section heading in place and shuffles only within the part it opens', () => {
    const paper = paperOf([heading(100), ...eight.slice(0, 4), heading(200), ...eight.slice(4)]);

    const shuffled = shufflePaper(paper, 'attempt-a', { questions: true, options: false }).questions.map(
      (q) => q.questionId
    );

    expect(shuffled[0]).toBe(100);
    expect(shuffled[5]).toBe(200);
    expect(shuffled.slice(1, 5).sort()).toEqual([1, 2, 3, 4]);
    expect(shuffled.slice(6).sort()).toEqual([5, 6, 7, 8]);
  });

  it('shuffles the options of a choice question and keeps every option id', () => {
    const shuffled = shufflePaper(paperOf(eight), 'attempt-a', { questions: false, options: true });
    const reordered = shuffled.questions.filter((q, index) => optionIds(q).join() !== optionIds(eight[index]).join());

    expect(reordered.length).toBeGreaterThan(0);
    for (const question of shuffled.questions) {
      expect(optionIds(question).sort()).toEqual(optionIds(eight[question.questionId - 1]).sort());
    }
  });

  it('never reorders a true or false pair', () => {
    const paper = paperOf([choice(1, ['Đúng', 'Sai'], 'true_false')]);

    expect(optionIds(shufflePaper(paper, 'attempt-a', { questions: false, options: true }).questions[0])).toEqual([
      'q1-0',
      'q1-1'
    ]);
  });

  it.each([
    'Tất cả các đáp án trên',
    'Cả A và B',
    'Cả hai ý trên đều đúng',
    'Không có đáp án nào đúng',
    'All of the above',
    'None of the above'
  ])('never reorders options when one of them points at the others: %s', (text) => {
    const question = choice(1, ['one', 'two', 'three', text]);
    const seeds = ['a', 'b', 'c', 'd', 'e', 'f'];

    for (const seed of seeds) {
      expect(
        optionIds(shufflePaper(paperOf([question]), seed, { questions: false, options: true }).questions[0])
      ).toEqual(['q1-0', 'q1-1', 'q1-2', 'q1-3']);
    }
  });
});
