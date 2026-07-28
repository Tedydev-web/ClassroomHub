import { describe, expect, it } from 'vitest';

import { examImportDraftSchema } from '../src/draft/exam-import-draft';
import { validateExamImportDraft } from '../src/draft/exam-import-validation';
import { MAX_GIFT_INPUT_CHARACTERS, parseGift } from '../src/interchange/gift';

const source = {
  assetId: 'gift-asset-1',
  fileName: 'sample.gift',
  mimeType: 'text/plain'
};

const validationContext = {
  enabledQuestionKinds: new Set(['choice'] as const),
  sanitizeHtml: (html: string) => html
};

describe('parseGift', () => {
  it('creates a validated deterministic choice draft and preserves typed feedback', () => {
    const gift = String.raw`::Capital\: city::Which value is <correct>? {
=A\=1#Correct \# one
~B\~2#Wrong
####Overall \{review\}
}`;

    const first = parseGift({ text: gift, source });
    const second = parseGift({ text: gift, source });

    expect(second).toEqual(first);
    expect(examImportDraftSchema.safeParse(first.draft).success).toBe(true);
    expect(validateExamImportDraft(first.draft, validationContext).publishable).toBe(true);
    expect(first.findings).toEqual([]);
    expect(first.draft).toMatchObject({
      source: { ...source, extractor: 'gift' },
      title: 'sample',
      sections: [
        {
          id: 'gift-section-1',
          questions: [
            {
              id: 'gift-question-1',
              kind: 'choice',
              sourceNumber: 'Capital: city',
              promptHtml: '<p>Which value is &lt;correct&gt;?</p>',
              cardinality: 'single',
              options: [
                { id: 'gift-option-1-1', html: '<p>A=1</p>' },
                { id: 'gift-option-1-2', html: '<p>B~2</p>' }
              ],
              feedback: [
                { optionId: 'gift-option-1-1', html: '<p>Correct # one</p>' },
                { optionId: 'gift-option-1-2', html: '<p>Wrong</p>' },
                { optionId: null, html: '<p>Overall {review}</p>' }
              ],
              answerKey: {
                kind: 'choice',
                correctOptionIds: ['gift-option-1-1']
              }
            }
          ]
        }
      ]
    });
    expect(first.feedback).toEqual([
      {
        kind: 'answer',
        questionId: 'gift-question-1',
        optionId: 'gift-option-1-1',
        html: '<p>Correct # one</p>',
        line: 2
      },
      {
        kind: 'answer',
        questionId: 'gift-question-1',
        optionId: 'gift-option-1-2',
        html: '<p>Wrong</p>',
        line: 3
      },
      {
        kind: 'general',
        questionId: 'gift-question-1',
        html: '<p>Overall {review}</p>',
        line: 4
      }
    ]);
  });

  it('preserves explicit binary weights', () => {
    const result = parseGift({
      text: '::Binary weights::Select one {~%0%Wrong =%100%Right}',
      source
    });

    expect(result.findings).toEqual([]);
    expect(result.draft.sections[0]?.questions[0]).toMatchObject({
      kind: 'choice',
      options: [
        { id: 'gift-option-1-1', html: '<p>Wrong</p>' },
        { id: 'gift-option-1-2', html: '<p>Right</p>' }
      ],
      answerKey: { correctOptionIds: ['gift-option-1-2'] },
      scoreWeights: { 'gift-option-1-1': 0, 'gift-option-1-2': 100 }
    });
  });

  it('preserves partial-credit weights in a publishable choice draft', () => {
    const result = parseGift({
      text: ['::Plain::First? {=Yes ~No}', '', '::Weighted::Second?', '{', '~%50%Half', '~%50%Other', '}'].join('\n'),
      source
    });

    expect(result.draft.sections[0]?.questions).toHaveLength(2);
    expect(result.draft.sections[0]?.questions[1]).toMatchObject({
      id: 'gift-question-2',
      kind: 'choice',
      cardinality: 'multiple',
      scoreWeights: {
        'gift-option-2-1': 50,
        'gift-option-2-2': 50
      },
      answerKey: {
        correctOptionIds: ['gift-option-2-1', 'gift-option-2-2']
      }
    });
    expect(result.findings).toEqual([]);
    expect(validateExamImportDraft(result.draft, validationContext).publishable).toBe(true);
  });

  it('turns unsupported answer constructs into unresolved questions instead of dropping them', () => {
    const result = parseGift({
      text: ['::Choice::Supported? {=Yes ~No}', '', '::Boolean::Unsupported? {TRUE}'].join('\n'),
      source
    });

    expect(result.draft.sections[0]?.questions).toHaveLength(2);
    expect(result.draft.sections[0]?.questions[1]).toMatchObject({
      id: 'gift-question-2',
      kind: 'unresolved'
    });
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'GIFT_ANSWER_TYPE_UNSUPPORTED',
        message: expect.stringContaining('Line 3'),
        questionId: 'gift-question-2'
      })
    );
  });

  it('reports malformed records at their source line', () => {
    const result = parseGift({
      text: ['::Valid::Question? {=A ~B}', '', '::Broken::Question? {=A ~B'].join('\n'),
      source
    });

    expect(result.draft.sections[0]?.questions[1]).toMatchObject({ kind: 'unresolved' });
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'GIFT_SYNTAX_INVALID',
        message: expect.stringContaining('Line 3'),
        provenance: [
          expect.objectContaining({
            start: { blockIndex: 2, runIndex: 0 }
          })
        ]
      })
    );
  });

  it('reports unknown escape sequences instead of silently normalizing them', () => {
    const result = parseGift({
      text: String.raw`::Escape::Question? {=Good ~Bad\q}`,
      source
    });

    expect(result.draft.sections[0]?.questions[0]).toMatchObject({ kind: 'unresolved' });
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'GIFT_ESCAPE_UNSUPPORTED',
        message: expect.stringContaining('Line 1'),
        blocking: true
      })
    );
  });

  it('fails closed when an explicit question title is empty', () => {
    const result = parseGift({
      text: '::::Question? {=Good ~Bad}',
      source
    });

    expect(examImportDraftSchema.safeParse(result.draft).success).toBe(true);
    expect(result.draft.sections[0]?.questions[0]).toMatchObject({ kind: 'unresolved' });
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'GIFT_TITLE_UNSUPPORTED',
        message: expect.stringContaining('Line 1'),
        blocking: true
      })
    );
  });

  it('rejects oversized input before splitting blocks', () => {
    const result = parseGift({ text: 'x'.repeat(MAX_GIFT_INPUT_CHARACTERS + 1), source });

    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: 'GIFT_DOCUMENT_TOO_LARGE', blocking: true })
    );
    expect(result.draft.sections[0]?.questions).toEqual([]);
  });
});
