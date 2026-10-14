import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { hashSittingSignal } from './exam-sitting-signals';

describe('hashSittingSignal', () => {
  it('answers null for a signal the browser did not send', () => {
    expect(hashSittingSignal(undefined)).toBeNull();
    expect(hashSittingSignal(null)).toBeNull();
    expect(hashSittingSignal('   ')).toBeNull();
  });

  it('gives the same hash for the same signal, so two sittings can be matched', () => {
    expect(hashSittingSignal('device-1')).toBe(hashSittingSignal('device-1'));
    expect(hashSittingSignal('device-1')).not.toBe(hashSittingSignal('device-2'));
  });

  it('is salted, so a short fingerprint cannot be recovered by hashing every guess', () => {
    const fingerprint = '1920x1080|Asia/Saigon|vi-VN';

    expect(hashSittingSignal(fingerprint)).not.toBe(createHash('sha256').update(fingerprint).digest('hex'));
  });
});
