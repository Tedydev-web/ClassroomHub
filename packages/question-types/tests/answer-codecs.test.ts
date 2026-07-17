import { describe, expect, it } from 'vitest';
import {
  QUESTION_TYPE_KEY,
  decodeApiPayload,
  decodeStoredAnswerData,
  fromApiPayload,
  toApiPayload,
  type AnswerData,
  type ExerciseQuestionModel
} from '../src';

function buildQuestion(overrides: Partial<ExerciseQuestionModel> = {}): ExerciseQuestionModel {
  return {
    id: 1,
    title: 'Question',
    questionType: QUESTION_TYPE_KEY.RADIO,
    points: 10,
    options: [
      { id: 11, label: 'First', isCorrect: true },
      { id: 12, label: 'Second', isCorrect: false },
      { id: 13, label: 'Third', isCorrect: false }
    ],
    settings: {},
    ...overrides
  };
}

describe('answer codec validation', () => {
  it('returns an invalid result instead of throwing for malformed JSON', () => {
    const question = buildQuestion({ questionType: QUESTION_TYPE_KEY.CHECKBOX });

    expect(() =>
      decodeApiPayload(QUESTION_TYPE_KEY.CHECKBOX, { questionId: 1, answer: '{not-json' }, question)
    ).not.toThrow();
    expect(
      decodeApiPayload(QUESTION_TYPE_KEY.CHECKBOX, { questionId: 1, answer: '{not-json' }, question)
    ).toMatchObject({ success: false, reason: 'invalid' });
    expect(fromApiPayload(QUESTION_TYPE_KEY.CHECKBOX, { questionId: 1, answer: '{not-json' }, question)).toBeNull();
  });

  it('distinguishes a missing answer from an invalid answer', () => {
    const question = buildQuestion({ questionType: QUESTION_TYPE_KEY.NUMERIC });

    expect(decodeApiPayload(QUESTION_TYPE_KEY.NUMERIC, { questionId: 1 }, question)).toMatchObject({
      success: false,
      reason: 'missing'
    });
    expect(
      decodeApiPayload(
        QUESTION_TYPE_KEY.NUMERIC,
        { questionId: 1, answer: JSON.stringify({ type: 'NUMERIC', value: '10' }) },
        question
      )
    ).toMatchObject({ success: false, reason: 'invalid' });
  });

  it('rejects unknown and duplicate option ids', () => {
    const checkbox = buildQuestion({ questionType: QUESTION_TYPE_KEY.CHECKBOX });
    const radio = buildQuestion({ questionType: QUESTION_TYPE_KEY.RADIO });

    expect(decodeApiPayload(QUESTION_TYPE_KEY.RADIO, { questionId: 1, optionId: 999 }, radio)).toMatchObject({
      success: false,
      reason: 'invalid'
    });
    expect(
      decodeApiPayload(
        QUESTION_TYPE_KEY.CHECKBOX,
        { questionId: 1, answer: JSON.stringify({ type: 'CHECKBOX', optionIds: [11, 11] }) },
        checkbox
      )
    ).toMatchObject({ success: false, reason: 'invalid' });
    expect(
      decodeApiPayload(
        QUESTION_TYPE_KEY.CHECKBOX,
        { questionId: 1, answer: JSON.stringify({ type: 'CHECKBOX', optionIds: [11, 999] }) },
        checkbox
      )
    ).toMatchObject({ success: false, reason: 'invalid' });
  });

  it('rejects non-finite numeric answers and wrong discriminators', () => {
    const question = buildQuestion({ questionType: QUESTION_TYPE_KEY.NUMERIC });

    expect(
      decodeApiPayload(
        QUESTION_TYPE_KEY.NUMERIC,
        { questionId: 1, answer: JSON.stringify({ type: 'STAR', value: 10 }) },
        question
      )
    ).toMatchObject({ success: false, reason: 'invalid' });
    expect(
      decodeApiPayload(
        QUESTION_TYPE_KEY.NUMERIC,
        { questionId: 1, answer: JSON.stringify({ type: 'NUMERIC', value: null }) },
        question
      )
    ).toMatchObject({ success: false, reason: 'invalid' });
  });

  it('rejects malformed arrays instead of coercing arbitrary values to strings', () => {
    const fillBlank = buildQuestion({ questionType: QUESTION_TYPE_KEY.FILL_BLANK });
    const links = buildQuestion({ questionType: QUESTION_TYPE_KEY.LINK });

    expect(
      decodeApiPayload(
        QUESTION_TYPE_KEY.FILL_BLANK,
        { questionId: 1, answer: JSON.stringify({ type: 'FILL_BLANK', answers: ['one', { value: 'two' }] }) },
        fillBlank
      )
    ).toMatchObject({ success: false, reason: 'invalid' });
    expect(
      decodeApiPayload(
        QUESTION_TYPE_KEY.LINK,
        { questionId: 1, answer: JSON.stringify({ type: 'LINK', links: ['https://example.com', 42] }) },
        links
      )
    ).toMatchObject({ success: false, reason: 'invalid' });
    expect(
      decodeApiPayload(
        QUESTION_TYPE_KEY.LINK,
        { questionId: 1, answer: JSON.stringify({ type: 'LINK', links: ['javascript:alert(1)'] }) },
        links
      )
    ).toMatchObject({ success: false, reason: 'invalid' });
  });

  it('rejects oversized structured answers and collections', () => {
    const checkbox = buildQuestion({ questionType: QUESTION_TYPE_KEY.CHECKBOX });
    const links = buildQuestion({ questionType: QUESTION_TYPE_KEY.LINK });

    expect(
      decodeApiPayload(
        QUESTION_TYPE_KEY.CHECKBOX,
        { questionId: 1, answer: JSON.stringify({ type: 'CHECKBOX', optionIds: Array(501).fill(11) }) },
        checkbox
      )
    ).toMatchObject({ success: false, reason: 'invalid' });
    expect(
      decodeApiPayload(
        QUESTION_TYPE_KEY.LINK,
        {
          questionId: 1,
          answer: JSON.stringify({ type: 'LINK', links: [`https://example.com/${'a'.repeat(2_100)}`] })
        },
        links
      )
    ).toMatchObject({ success: false, reason: 'invalid' });
    expect(
      decodeApiPayload(QUESTION_TYPE_KEY.LINK, { questionId: 1, answer: 'x'.repeat(1_000_001) }, links)
    ).toMatchObject({ success: false, reason: 'invalid' });
  });

  it('rejects duplicate matching pairs, ordering values, and hotspot coordinates', () => {
    const matching = buildQuestion({ questionType: QUESTION_TYPE_KEY.MATCHING });
    const ordering = buildQuestion({ questionType: QUESTION_TYPE_KEY.ORDERING });
    const hotspot = buildQuestion({ questionType: QUESTION_TYPE_KEY.HOTSPOT });

    expect(
      decodeApiPayload(
        QUESTION_TYPE_KEY.MATCHING,
        {
          questionId: 1,
          answer: JSON.stringify({
            type: 'MATCHING',
            value: [
              { left: 'A', right: '1' },
              { left: 'A', right: '1' }
            ]
          })
        },
        matching
      )
    ).toMatchObject({ success: false, reason: 'invalid' });
    expect(
      decodeApiPayload(
        QUESTION_TYPE_KEY.ORDERING,
        { questionId: 1, answer: JSON.stringify({ type: 'ORDERING', value: ['11', '11', '13'] }) },
        ordering
      )
    ).toMatchObject({ success: false, reason: 'invalid' });
    expect(
      decodeApiPayload(
        QUESTION_TYPE_KEY.HOTSPOT,
        {
          questionId: 1,
          answer: JSON.stringify({
            type: 'HOTSPOT',
            value: [
              { x: 10, y: 20 },
              { x: 10, y: 20 }
            ]
          })
        },
        hotspot
      )
    ).toMatchObject({ success: false, reason: 'invalid' });
  });

  it('validates file metadata before creating structured answer data', () => {
    const question = buildQuestion({ questionType: QUESTION_TYPE_KEY.FILE_UPLOAD });
    const videoQuestion = buildQuestion({ questionType: QUESTION_TYPE_KEY.VIDEO_RECORDING });

    expect(
      decodeApiPayload(
        QUESTION_TYPE_KEY.FILE_UPLOAD,
        {
          questionId: 1,
          answer: JSON.stringify({ fileKey: '', fileName: 'answer.pdf', mimeType: 'application/pdf', size: -1 })
        },
        question
      )
    ).toMatchObject({ success: false, reason: 'invalid' });
    expect(
      decodeApiPayload(
        QUESTION_TYPE_KEY.VIDEO_RECORDING,
        {
          questionId: 1,
          answer: JSON.stringify({
            type: 'VIDEO_RECORDING',
            assetId: 'asset-a',
            storageKey: 'recordings/answer.webm',
            fileName: 'answer.webm',
            mimeType: 'video/webm',
            size: 1024,
            durationSeconds: 20,
            recordedAt: 'not-a-date',
            uploadedAt: '2026-07-16T00:00:00.000Z',
            provider: 'cloudflare',
            retakeCount: -1
          })
        },
        videoQuestion
      )
    ).toMatchObject({ success: false, reason: 'invalid' });
  });

  it('requires file uploads to reference a managed asset', () => {
    const question = buildQuestion({ questionType: QUESTION_TYPE_KEY.FILE_UPLOAD });
    const managedFileAnswer = {
      type: 'FILE_UPLOAD',
      assetId: 'asset-a',
      fileKey: 'exercise-files/org-a/course-a/exercise-a/1/member-a/answer.pdf',
      fileName: 'answer.pdf',
      mimeType: 'application/pdf',
      size: 1_024
    } as const;

    expect(decodeApiPayload(QUESTION_TYPE_KEY.FILE_UPLOAD, toApiPayload(managedFileAnswer, 1), question)).toEqual({
      success: true,
      data: managedFileAnswer
    });
    expect(
      decodeApiPayload(
        QUESTION_TYPE_KEY.FILE_UPLOAD,
        {
          questionId: 1,
          answer: JSON.stringify({
            fileKey: managedFileAnswer.fileKey,
            fileName: managedFileAnswer.fileName,
            mimeType: managedFileAnswer.mimeType,
            size: managedFileAnswer.size
          })
        },
        question
      )
    ).toMatchObject({ success: false, reason: 'invalid' });
  });

  it('round-trips representative valid structured answers', () => {
    const cases: Array<{ answer: AnswerData; question: ExerciseQuestionModel }> = [
      {
        answer: { type: 'CHECKBOX', optionIds: [11, 13] },
        question: buildQuestion({ questionType: QUESTION_TYPE_KEY.CHECKBOX })
      },
      {
        answer: { type: 'NUMERIC', value: 12.5 },
        question: buildQuestion({ questionType: QUESTION_TYPE_KEY.NUMERIC })
      },
      {
        answer: { type: 'ORDERING', orderedValues: ['11', '12', '13'] },
        question: buildQuestion({ questionType: QUESTION_TYPE_KEY.ORDERING })
      },
      {
        answer: {
          type: 'FILE_UPLOAD',
          assetId: 'asset-a',
          fileKey: 'exercise-files/org-a/course-a/exercise-a/1/member-a/answer.pdf',
          fileName: 'answer.pdf',
          mimeType: 'application/pdf',
          size: 1_024
        },
        question: buildQuestion({ questionType: QUESTION_TYPE_KEY.FILE_UPLOAD })
      }
    ];

    for (const testCase of cases) {
      const payload = toApiPayload(testCase.answer, 1);
      const decoded = decodeApiPayload(testCase.answer.type, payload, testCase.question);

      expect(decoded).toEqual({ success: true, data: testCase.answer });
    }
  });

  it('decodes valid autosaved data through the canonical question codec', () => {
    const question = buildQuestion({ questionType: QUESTION_TYPE_KEY.CHECKBOX });

    expect(decodeStoredAnswerData({ type: 'CHECKBOX', optionIds: [11, 13] }, question)).toEqual({
      type: 'CHECKBOX',
      optionIds: [11, 13]
    });
    expect(decodeStoredAnswerData({ type: 'CHECKBOX', optionIds: [11, 999] }, question)).toBeNull();
    expect(decodeStoredAnswerData({ type: 'UNKNOWN', optionIds: [11] }, question)).toBeNull();
  });
});
