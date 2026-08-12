import { describe, expect, it } from 'vitest';

import { mergeAnswers, validateAnswers, validateDeclaredIdentity } from './exam-attempt';
import type { ExamPaperSnapshot } from './exam-paper-serializer';

/**
 * Merging answers and refusing bad ones. Both live at the trust boundary, and both have a
 * failure mode that is invisible until a student complains.
 */

function snapshot(questionIds: number[]): ExamPaperSnapshot {
  return {
    frozenAt: '2026-08-12T00:00:00.000Z',
    questions: questionIds.map((questionId, index) => ({
      questionId,
      questionRevisionId: `rev-${questionId}`,
      order: index + 1,
      points: 1,
      definition: { schemaVersion: 1, blocks: [] } as never
    }))
  };
}

describe('merging answers', () => {
  const paper = snapshot([1, 2, 3]);

  it('keeps answers the save did not mention — the autosave data-loss bug', () => {
    const existing = [
      { questionId: 1, questionRevisionId: 'rev-1', answerData: 'A' },
      { questionId: 2, questionRevisionId: 'rev-2', answerData: 'B' }
    ];

    const merged = mergeAnswers(existing, [{ questionId: 3, answerData: 'C' }], paper);

    expect(merged).toHaveLength(3);
    expect(merged.find((answer) => answer.questionId === 1)?.answerData).toBe('A');
    expect(merged.find((answer) => answer.questionId === 2)?.answerData).toBe('B');
  });

  it('replaces an answer to a question already answered, rather than adding a second', () => {
    const existing = [{ questionId: 1, questionRevisionId: 'rev-1', answerData: 'A' }];

    const merged = mergeAnswers(existing, [{ questionId: 1, answerData: 'D' }], paper);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.answerData).toBe('D');
  });

  it('stamps the revision from the frozen paper, never from the request', () => {
    const merged = mergeAnswers([], [{ questionId: 2, answerData: 'B' }], paper);

    expect(merged[0]?.questionRevisionId).toBe('rev-2');
  });

  it('ignores an answer to a question the paper does not contain', () => {
    const merged = mergeAnswers([], [{ questionId: 99, answerData: 'X' }], paper);

    expect(merged).toEqual([]);
  });
});

describe('validating answers', () => {
  const paper = snapshot([1, 2]);

  it('refuses a question outside the paper, which would otherwise poison the attempt', () => {
    expect(validateAnswers([{ questionId: 7, answerData: 'A' }], paper)).not.toEqual([]);
  });

  it('accepts answers the paper contains', () => {
    expect(validateAnswers([{ questionId: 1, answerData: 'A' }], paper)).toEqual([]);
  });

  it('refuses an implausibly large payload', () => {
    const many = Array.from({ length: 501 }, (_, index) => ({ questionId: index, answerData: 'A' }));

    expect(validateAnswers(many, paper)).not.toEqual([]);
  });
});

describe('validating who is sitting', () => {
  const requiresNameOnly = { name: true, className: false, candidateNumber: false };

  it('refuses a missing name when the exam asks for one', () => {
    expect(validateDeclaredIdentity({}, requiresNameOnly)).not.toEqual([]);
  });

  it('refuses a name of only whitespace', () => {
    expect(validateDeclaredIdentity({ displayName: '   ' }, requiresNameOnly)).not.toEqual([]);
  });

  it('refuses an over-long name', () => {
    expect(validateDeclaredIdentity({ displayName: 'x'.repeat(200) }, requiresNameOnly)).not.toEqual([]);
  });

  it('accepts a Vietnamese name with its diacritics', () => {
    expect(validateDeclaredIdentity({ displayName: 'Nguyễn Thị Ánh Nguyệt' }, requiresNameOnly)).toEqual([]);
  });

  it('asks only for the fields the exam requires', () => {
    expect(validateDeclaredIdentity({ displayName: 'A' }, requiresNameOnly)).toEqual([]);
    expect(
      validateDeclaredIdentity({ displayName: 'A' }, { name: true, className: true, candidateNumber: false })
    ).not.toEqual([]);
  });
});
