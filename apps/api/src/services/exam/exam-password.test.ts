import { describe, expect, it } from 'vitest';

import { hashExamPassword, verifyExamPassword } from './exam-password';

describe('the password on an exam link', () => {
  it('accepts the password it was given', async () => {
    const stored = await hashExamPassword('mật khẩu ca 1');

    await expect(verifyExamPassword('mật khẩu ca 1', stored)).resolves.toBe(true);
  });

  it('refuses anything else, including a prefix of the right answer', async () => {
    const stored = await hashExamPassword('mật khẩu ca 1');

    await expect(verifyExamPassword('mật khẩu ca 2', stored)).resolves.toBe(false);
    await expect(verifyExamPassword('mật khẩu ca', stored)).resolves.toBe(false);
    await expect(verifyExamPassword('', stored)).resolves.toBe(false);
  });

  it('hashes the same password to different stored values', async () => {
    const [first, second] = await Promise.all([hashExamPassword('same'), hashExamPassword('same')]);

    // A shared salt would let one leaked table be read across every exam at once.
    expect(first).not.toBe(second);
    await expect(verifyExamPassword('same', first)).resolves.toBe(true);
    await expect(verifyExamPassword('same', second)).resolves.toBe(true);
  });

  it('refuses a stored value it does not recognise rather than throwing', async () => {
    await expect(verifyExamPassword('anything', 'not-a-hash')).resolves.toBe(false);
    await expect(verifyExamPassword('anything', '')).resolves.toBe(false);
  });
});
