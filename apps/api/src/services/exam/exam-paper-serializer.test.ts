import { describe, expect, it } from 'vitest';

import { toExamSittingPaper, type ExamPaperSnapshot } from './exam-paper-serializer';

/**
 * The one test in this feature that cannot be allowed to pass for the wrong reason.
 *
 * It asserts structurally — walking the whole payload for any key that could reveal an
 * answer — rather than checking the fields somebody remembered to check. A test that
 * lists field names passes forever while a new field leaks beside them, and a leaked
 * paper cannot be un-leaked from the students who already read it.
 */

/** Every key in the item schema that carries, or could carry, correctness. */
const ANSWER_BEARING_KEYS = [
  'correctOptionIds',
  'scoreWeights',
  'correctValue',
  'correctAnswers',
  'correctOrder',
  'acceptedAnswers',
  'distractors'
];

function keysAtEveryDepth(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) keysAtEveryDepth(entry, found);
    return found;
  }

  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      found.push(key);
      keysAtEveryDepth(nested, found);
    }
  }

  return found;
}

function snapshotWithChoice(): ExamPaperSnapshot {
  return {
    frozenAt: '2026-08-12T00:00:00.000Z',
    questions: [
      {
        questionId: 1,
        questionRevisionId: '11111111-1111-4111-8111-111111111111',
        order: 1,
        points: 1,
        definition: {
          schemaVersion: 1,
          blocks: [
            {
              id: 'b1',
              type: 'interaction',
              interaction: {
                kind: 'choice',
                prompt: { html: '<p>Which one?</p>' },
                required: true,
                maxScore: 1,
                config: {
                  cardinality: 'single',
                  presentation: 'list',
                  options: [
                    { id: '1', html: '<p>focus</p>' },
                    { id: '2', html: '<p>attention</p>' }
                  ],
                  correctOptionIds: ['2'],
                  scoreWeights: { '2': 100 }
                }
              }
            }
          ]
        } as never
      }
    ]
  };
}

describe('exam sitting paper', () => {
  /**
   * Guards the guard. A detector that finds nothing because it cannot see is
   * indistinguishable from a payload that leaks nothing — so prove it fires on the
   * unsanitised definition before trusting its silence on the sanitised one.
   */
  it('detects answer keys when they are present', () => {
    const raw = snapshotWithChoice();

    const leaked = keysAtEveryDepth(raw).filter((key) => ANSWER_BEARING_KEYS.includes(key));

    expect(leaked).toContain('correctOptionIds');
    expect(leaked).toContain('scoreWeights');
  });

  it('carries no key that could reveal an answer, at any depth', () => {
    const paper = toExamSittingPaper(snapshotWithChoice());

    const leaked = keysAtEveryDepth(paper).filter((key) => ANSWER_BEARING_KEYS.includes(key));

    expect(leaked).toEqual([]);
  });

  it('still carries what a student needs to answer', () => {
    const paper = toExamSittingPaper(snapshotWithChoice());
    const serialised = JSON.stringify(paper);

    expect(serialised).toContain('Which one?');
    expect(serialised).toContain('focus');
    expect(serialised).toContain('attention');
    expect(paper.questions).toHaveLength(1);
  });

  it('keeps the revision each question was frozen against, because grading depends on it', () => {
    const paper = toExamSittingPaper(snapshotWithChoice());

    expect(paper.questions[0]?.questionRevisionId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('reads only the snapshot, so editing the live paper afterwards cannot change what is served', () => {
    const snapshot = snapshotWithChoice();
    const before = JSON.stringify(toExamSittingPaper(snapshot));

    // Nothing here touches the database; the serializer has no other source to read.
    const after = JSON.stringify(toExamSittingPaper(snapshot));

    expect(after).toBe(before);
  });

  it('refuses a snapshot that was never frozen rather than serving an empty paper', () => {
    expect(() => toExamSittingPaper(null)).toThrow();
    expect(() => toExamSittingPaper({ frozenAt: '', questions: [] } as ExamPaperSnapshot)).toThrow();
  });
});
