import { describe, expect, it } from 'vitest';

import { isSittingOver, refusalKey, refusalMessage } from './exam-refusals';

/**
 * The case this exists for, seen on a real device: the clock reached zero, the server had
 * already finalised the attempt, and the page put "This attempt is already finished" under
 * a paper whose Next button still worked. The candidate was told to keep going by the
 * buttons and told it was over by the text.
 */
const thrown = (message: string) => new Error(JSON.stringify({ success: false, error: message }));

describe('reading a refusal from the exam API', () => {
  it('finds the message inside a thrown 4xx', () => {
    expect(refusalMessage(thrown('Your time is up'))).toBe('Your time is up');
  });

  it('finds it in a parsed body too', () => {
    expect(refusalMessage({ success: false, error: '  This attempt is already finished  ' })).toBe(
      'This attempt is already finished'
    );
  });

  it('reads a genuine network failure as no refusal at all', () => {
    expect(refusalMessage(new Error('Failed to fetch'))).toBe('');
    expect(refusalMessage(undefined)).toBe('');
    expect(refusalMessage(null)).toBe('');
  });

  it('knows the two refusals that mean the sitting has ended', () => {
    expect(isSittingOver(thrown('Your time is up'))).toBe(true);
    expect(isSittingOver(thrown('This attempt is already finished'))).toBe(true);
  });

  it('does not treat a fixable refusal as the end', () => {
    // The candidate can still act on every one of these.
    expect(isSittingOver(thrown('Your full name is required'))).toBe(false);
    expect(isSittingOver(thrown('This exam needs the password your teacher gave you'))).toBe(false);
    expect(isSittingOver(thrown('Failed to fetch'))).toBe(false);
  });

  it('names our own wording where we have it, and admits when we do not', () => {
    expect(refusalKey(thrown('Your time is up'))).toBe('time_up');
    expect(refusalKey(thrown('Something we have never seen'))).toBeNull();
  });
});
