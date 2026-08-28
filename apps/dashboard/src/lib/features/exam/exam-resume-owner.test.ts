import { describe, expect, it } from 'vitest';

import { resumeOwnerDetails, resumeOwnerName, resumeStartedAtLabel } from './exam-resume-owner';

describe('resumeOwnerName', () => {
  it('keeps both halves when a nickname was typed', () => {
    // The nickname exists because two people in one class share a name. Showing either
    // half alone throws away the only thing that tells them apart.
    expect(resumeOwnerName({ displayName: 'Nguyễn Văn A', nickname: 'A còi' })).toBe('Nguyễn Văn A (A còi)');
  });

  it('falls back to the nickname when the exam never asked for a name', () => {
    expect(resumeOwnerName({ displayName: null, nickname: 'A còi' })).toBe('A còi');
  });

  it('treats whitespace as absence', () => {
    expect(resumeOwnerName({ displayName: '   ', nickname: '  ' })).toBeNull();
  });

  it('is null when the attempt carries no name at all', () => {
    expect(resumeOwnerName({})).toBeNull();
  });
});

describe('resumeOwnerDetails', () => {
  it('lists class then candidate number', () => {
    expect(resumeOwnerDetails({ className: '12A1', candidateNumber: 'SBD 07' })).toEqual(['12A1', 'SBD 07']);
  });

  it('leaves absent fields out rather than showing blanks', () => {
    expect(resumeOwnerDetails({ className: '12A1', candidateNumber: null })).toEqual(['12A1']);
    expect(resumeOwnerDetails({})).toEqual([]);
  });
});

describe('resumeStartedAtLabel', () => {
  it('reads in Vietnam time regardless of the device clock', () => {
    // 00:05 UTC is 07:05 in Ho Chi Minh City — the hour a school exam actually starts.
    expect(resumeStartedAtLabel('2026-08-28T00:05:00.000Z')).toBe('07:05');
  });

  it('is null for a missing or unparseable time', () => {
    expect(resumeStartedAtLabel(null)).toBeNull();
    expect(resumeStartedAtLabel('not a date')).toBeNull();
  });
});
