import { describe, expect, it } from 'vitest';

import { answersMissingFromServer } from './exam-answer-draft';

const choice = (id: string) => ({
  schemaVersion: 1,
  responses: [{ interactionId: 'b1', response: { kind: 'choice', selectedOptionIds: [id] } }]
});

describe('answersMissingFromServer', () => {
  it('returns nothing when the server already holds every kept answer', () => {
    expect(answersMissingFromServer([{ questionId: 1, answerData: choice('a') }], { 1: choice('a') })).toEqual([]);
  });

  it('returns kept answers the server never received', () => {
    expect(answersMissingFromServer([], { 3: choice('b') })).toEqual([{ questionId: 3, answerData: choice('b') }]);
  });

  it('returns a kept answer that changed after the server last saved it', () => {
    expect(answersMissingFromServer([{ questionId: 2, answerData: choice('a') }], { 2: choice('c') })).toEqual([
      { questionId: 2, answerData: choice('c') }
    ]);
  });

  it('leaves server answers alone when nothing is kept on the device', () => {
    expect(answersMissingFromServer([{ questionId: 1, answerData: choice('a') }], {})).toEqual([]);
  });
});
