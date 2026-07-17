import { describe, expect, it } from 'vitest';
import { validateAssessmentResponseEnvelope } from '../src/assessment';
import type { AssessmentIssueCode, AssessmentItemDefinition } from '../src/assessment';
import {
  buildDefinition,
  buildHybridDefinition,
  interactionBlock,
  buildChoiceInteraction
} from './fixtures/assessment/definition-builders';

const HYBRID = buildHybridDefinition();

function envelope(responses: Array<{ interactionId: string; response: unknown }>): unknown {
  return { schemaVersion: 1, responses };
}

function expectEnvelopeIssue(definition: AssessmentItemDefinition, value: unknown, code: AssessmentIssueCode): void {
  const result = validateAssessmentResponseEnvelope(definition, value);
  expect(result.success).toBe(false);
  if (result.success) return;

  expect(result.issues.map((issue) => issue.code)).toContain(code);
}

const VALID_CHOICE = { kind: 'choice', selectedOptionIds: ['a'] };
const VALID_TEXT = { kind: 'text', text: '<p>My detailed answer</p>' };
const VALID_STAR = { kind: 'star_rating', value: 4 };

describe('validateAssessmentResponseEnvelope — success paths', () => {
  it('accepts a full envelope for a hybrid item', () => {
    const result = validateAssessmentResponseEnvelope(
      HYBRID,
      envelope([
        { interactionId: 'i1', response: VALID_CHOICE },
        { interactionId: 'i2', response: VALID_TEXT },
        { interactionId: 'i3', response: VALID_STAR }
      ])
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.responsesByInteractionId.size).toBe(3);
    expect(result.data.missingOptionalInteractionIds).toEqual([]);
  });

  it('represents missing optional responses explicitly', () => {
    const result = validateAssessmentResponseEnvelope(
      HYBRID,
      envelope([
        { interactionId: 'i1', response: VALID_CHOICE },
        { interactionId: 'i2', response: VALID_TEXT }
      ])
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.missingOptionalInteractionIds).toEqual(['i3']);
    expect(result.data.responsesByInteractionId.has('i3')).toBe(false);
  });
});

describe('validateAssessmentResponseEnvelope — envelope failures', () => {
  it('rejects unsupported envelope schema versions', () => {
    expectEnvelopeIssue(HYBRID, { schemaVersion: 2, responses: [] }, 'UNSUPPORTED_SCHEMA_VERSION');
    expectEnvelopeIssue(HYBRID, {}, 'UNSUPPORTED_SCHEMA_VERSION');
  });

  it('rejects malformed envelopes', () => {
    expectEnvelopeIssue(HYBRID, null, 'MALFORMED_RESPONSE');
    expectEnvelopeIssue(HYBRID, { schemaVersion: 1, responses: 'nope' }, 'MALFORMED_RESPONSE');
    expectEnvelopeIssue(HYBRID, { schemaVersion: 1, responses: [], extra: true }, 'MALFORMED_RESPONSE');
  });

  it('rejects duplicate interaction entries before any map is built', () => {
    expectEnvelopeIssue(
      HYBRID,
      envelope([
        { interactionId: 'i1', response: VALID_CHOICE },
        { interactionId: 'i1', response: VALID_CHOICE },
        { interactionId: 'i2', response: VALID_TEXT }
      ]),
      'DUPLICATE_RESPONSE_ENTRY'
    );

    expectEnvelopeIssue(
      HYBRID,
      envelope([
        { interactionId: 'i1', response: VALID_CHOICE },
        { interactionId: 'i1', response: { kind: 'choice', selectedOptionIds: ['b'] } },
        { interactionId: 'i2', response: VALID_TEXT }
      ]),
      'DUPLICATE_RESPONSE_ENTRY'
    );
  });

  it('rejects unknown interaction ids, including ids of content blocks', () => {
    expectEnvelopeIssue(
      HYBRID,
      envelope([
        { interactionId: 'ghost', response: VALID_CHOICE },
        { interactionId: 'i2', response: VALID_TEXT }
      ]),
      'UNKNOWN_INTERACTION'
    );
    expectEnvelopeIssue(
      HYBRID,
      envelope([
        { interactionId: 'c1', response: VALID_CHOICE },
        { interactionId: 'i2', response: VALID_TEXT }
      ]),
      'UNKNOWN_INTERACTION'
    );
  });

  it('rejects a response whose kind does not match the interaction', () => {
    expectEnvelopeIssue(
      HYBRID,
      envelope([
        { interactionId: 'i1', response: VALID_TEXT },
        { interactionId: 'i2', response: VALID_TEXT }
      ]),
      'RESPONSE_KIND_MISMATCH'
    );
  });

  it('rejects missing required responses and meaningless required text', () => {
    expectEnvelopeIssue(
      HYBRID,
      envelope([{ interactionId: 'i1', response: VALID_CHOICE }]),
      'MISSING_REQUIRED_RESPONSE'
    );
    expectEnvelopeIssue(
      HYBRID,
      envelope([
        { interactionId: 'i1', response: VALID_CHOICE },
        { interactionId: 'i2', response: { kind: 'text', text: '<p> </p>' } }
      ]),
      'MISSING_REQUIRED_RESPONSE'
    );
  });
});

describe('validateAssessmentResponseEnvelope — per-kind constraints', () => {
  it('enforces single choice cardinality, uniqueness, and option membership', () => {
    const single = buildDefinition();

    expectEnvelopeIssue(
      single,
      envelope([{ interactionId: 'i1', response: { kind: 'choice', selectedOptionIds: ['a', 'b'] } }]),
      'RESPONSE_CONSTRAINT'
    );
    expectEnvelopeIssue(
      single,
      envelope([{ interactionId: 'i1', response: { kind: 'choice', selectedOptionIds: ['ghost'] } }]),
      'RESPONSE_CONSTRAINT'
    );

    const multiple = buildDefinition({
      blocks: [
        interactionBlock(
          'i1',
          buildChoiceInteraction({
            config: {
              cardinality: 'multiple',
              presentation: 'list',
              options: [
                { id: 'a', html: 'A' },
                { id: 'b', html: 'B' }
              ],
              correctOptionIds: ['a', 'b']
            }
          })
        )
      ]
    });
    expectEnvelopeIssue(
      multiple,
      envelope([{ interactionId: 'i1', response: { kind: 'choice', selectedOptionIds: ['a', 'a'] } }]),
      'RESPONSE_CONSTRAINT'
    );
  });

  it('enforces ordering exact permutation', () => {
    const ordering = buildDefinition({
      blocks: [
        interactionBlock('i1', {
          kind: 'ordering',
          prompt: { format: 'html', html: 'Order' },
          required: true,
          maxScore: 2,
          config: {
            options: [
              { id: 'a', html: 'A' },
              { id: 'b', html: 'B' }
            ],
            correctOrder: ['a', 'b']
          }
        })
      ]
    });

    for (const orderedOptionIds of [['a'], ['a', 'ghost'], ['a', 'a']]) {
      expectEnvelopeIssue(
        ordering,
        envelope([{ interactionId: 'i1', response: { kind: 'ordering', orderedOptionIds } }]),
        'RESPONSE_CONSTRAINT'
      );
    }
  });

  it('enforces fill_blank and word_bank counts plus bank membership', () => {
    const fillBlank = buildDefinition({
      blocks: [
        interactionBlock('i1', {
          kind: 'fill_blank',
          prompt: { format: 'html', html: 'Fill' },
          required: true,
          maxScore: 2,
          config: { acceptedAnswers: ['one', 'two'] }
        })
      ]
    });
    const wordBank = buildDefinition({
      blocks: [
        interactionBlock('i1', {
          kind: 'word_bank',
          prompt: { format: 'html', html: 'Complete' },
          required: true,
          maxScore: 2,
          config: { template: '___ and ___', correctAnswers: ['cat', 'mat'], distractors: ['dog'] }
        })
      ]
    });

    expectEnvelopeIssue(
      fillBlank,
      envelope([{ interactionId: 'i1', response: { kind: 'fill_blank', values: ['only-one'] } }]),
      'RESPONSE_CONSTRAINT'
    );
    expectEnvelopeIssue(
      wordBank,
      envelope([{ interactionId: 'i1', response: { kind: 'word_bank', filledBlanks: ['cat', 'ghost'] } }]),
      'RESPONSE_CONSTRAINT'
    );

    const okBank = validateAssessmentResponseEnvelope(
      wordBank,
      envelope([{ interactionId: 'i1', response: { kind: 'word_bank', filledBlanks: ['dog', 'mat'] } }])
    );
    expect(okBank.success).toBe(true);
  });

  it('enforces star range against config and structural bounds', () => {
    expectEnvelopeIssue(
      HYBRID,
      envelope([
        { interactionId: 'i1', response: VALID_CHOICE },
        { interactionId: 'i2', response: VALID_TEXT },
        { interactionId: 'i3', response: { kind: 'star_rating', value: 9 } }
      ]),
      'RESPONSE_CONSTRAINT'
    );
    expectEnvelopeIssue(
      HYBRID,
      envelope([
        { interactionId: 'i1', response: VALID_CHOICE },
        { interactionId: 'i2', response: VALID_TEXT },
        { interactionId: 'i3', response: { kind: 'star_rating', value: 0 } }
      ]),
      'MALFORMED_RESPONSE'
    );
    expectEnvelopeIssue(
      HYBRID,
      envelope([
        { interactionId: 'i1', response: VALID_CHOICE },
        { interactionId: 'i2', response: VALID_TEXT },
        { interactionId: 'i3', response: { kind: 'star_rating', value: 2.5 } }
      ]),
      'MALFORMED_RESPONSE'
    );
  });

  it('rejects non-finite numeric values and text over the configured max', () => {
    const numeric = buildDefinition({
      blocks: [
        interactionBlock('i1', {
          kind: 'numeric',
          prompt: { format: 'html', html: 'Number' },
          required: true,
          maxScore: 1,
          config: { correctValue: 5, tolerance: 0 }
        })
      ]
    });
    expectEnvelopeIssue(
      numeric,
      envelope([{ interactionId: 'i1', response: { kind: 'numeric', value: Number.POSITIVE_INFINITY } }]),
      'MALFORMED_RESPONSE'
    );

    const boundedText = buildDefinition({
      blocks: [
        interactionBlock('i1', {
          kind: 'text',
          prompt: { format: 'html', html: 'Explain' },
          required: true,
          maxScore: 1,
          config: { format: 'plain', maxCharacters: 5 }
        })
      ]
    });
    expectEnvelopeIssue(
      boundedText,
      envelope([{ interactionId: 'i1', response: { kind: 'text', text: 'way too long' } }]),
      'RESPONSE_CONSTRAINT'
    );
  });

  it('rejects invalid link and video recording payloads', () => {
    const link = buildDefinition({
      blocks: [
        interactionBlock('i1', {
          kind: 'link',
          prompt: { format: 'html', html: 'Links' },
          required: true,
          maxScore: 1,
          config: {}
        })
      ]
    });
    expectEnvelopeIssue(
      link,
      envelope([{ interactionId: 'i1', response: { kind: 'link', urls: ['ftp://nope.example'] } }]),
      'MALFORMED_RESPONSE'
    );

    const video = buildDefinition({
      blocks: [
        interactionBlock('i1', {
          kind: 'video_recording',
          prompt: { format: 'html', html: 'Record' },
          required: true,
          maxScore: 1,
          config: { maxDurationSeconds: 60 }
        })
      ]
    });
    const validVideo = {
      kind: 'video_recording',
      assetId: 'asset-1',
      storageKey: 'videos/asset-1.webm',
      fileName: 'answer.webm',
      mimeType: 'video/webm',
      size: 1024,
      durationSeconds: 30,
      recordedAt: '2026-07-16T00:00:00.000Z',
      uploadedAt: '2026-07-16T00:01:00.000Z',
      provider: 'cloudflare'
    };

    expect(
      validateAssessmentResponseEnvelope(video, envelope([{ interactionId: 'i1', response: validVideo }])).success
    ).toBe(true);
    expectEnvelopeIssue(
      video,
      envelope([{ interactionId: 'i1', response: { ...validVideo, durationSeconds: 90 } }]),
      'RESPONSE_CONSTRAINT'
    );
    expectEnvelopeIssue(
      video,
      envelope([{ interactionId: 'i1', response: { ...validVideo, mimeType: 'application/pdf' } }]),
      'MALFORMED_RESPONSE'
    );
  });

  it('enforces file upload type and configured size', () => {
    const fileUpload = buildDefinition({
      blocks: [
        interactionBlock('i1', {
          kind: 'file_upload',
          prompt: { format: 'html', html: 'Upload' },
          required: true,
          maxScore: 1,
          config: { acceptedTypes: ['application/pdf'], maxSizeMb: 1 }
        })
      ]
    });
    const validFile = {
      kind: 'file_upload',
      assetId: 'asset-1',
      fileKey: 'files/asset-1.pdf',
      fileName: 'answer.pdf',
      mimeType: 'application/pdf',
      size: 1024 * 1024
    };

    expect(
      validateAssessmentResponseEnvelope(fileUpload, envelope([{ interactionId: 'i1', response: validFile }])).success
    ).toBe(true);
    expectEnvelopeIssue(
      fileUpload,
      envelope([{ interactionId: 'i1', response: { ...validFile, mimeType: 'image/png' } }]),
      'RESPONSE_CONSTRAINT'
    );
    expectEnvelopeIssue(
      fileUpload,
      envelope([{ interactionId: 'i1', response: { ...validFile, size: 1024 * 1024 + 1 } }]),
      'RESPONSE_CONSTRAINT'
    );
  });
});
