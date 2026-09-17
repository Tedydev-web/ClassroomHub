import { describe, expect, it } from 'vitest';

import { readCandidateName } from './read-candidate-name';

describe('readCandidateName', () => {
  it('reads the display name from an attempt response', () => {
    expect(readCandidateName({ data: { attempt: { displayName: 'Nguyễn Văn A' } } })).toBe('Nguyễn Văn A');
  });

  it('returns null for a blank name, so the caller can fall back to its own wording', () => {
    expect(readCandidateName({ data: { attempt: { displayName: '   ' } } })).toBeNull();
  });

  it('returns null rather than throwing for any shape that is not an attempt response', () => {
    expect(readCandidateName(null)).toBeNull();
    expect(readCandidateName('text')).toBeNull();
    expect(readCandidateName({})).toBeNull();
    expect(readCandidateName({ data: null })).toBeNull();
    expect(readCandidateName({ data: { attempt: null } })).toBeNull();
    expect(readCandidateName({ data: { attempt: {} } })).toBeNull();
    expect(readCandidateName({ data: { attempt: { displayName: 42 } } })).toBeNull();
  });
});
