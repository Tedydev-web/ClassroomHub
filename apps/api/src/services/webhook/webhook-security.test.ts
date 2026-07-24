import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  assertWebhookUrl,
  decryptWebhookSecret,
  encryptWebhookSecret,
  signWebhookPayload
} from '@cio/core/utils/webhook-security';

describe('webhook security', () => {
  const encryptionKey = 'test-encryption-key-with-sufficient-entropy';

  it('encrypts and decrypts a webhook secret', () => {
    const secret = 'outbound-signing-secret';
    const encrypted = encryptWebhookSecret(secret, encryptionKey);

    expect(encrypted).not.toContain(secret);
    expect(decryptWebhookSecret(encrypted, encryptionKey)).toBe(secret);
  });

  it('rejects a modified encrypted secret', () => {
    const encrypted = encryptWebhookSecret('outbound-signing-secret', encryptionKey);
    const [initializationVector, authTag, ciphertext] = encrypted.split('.');
    if (!initializationVector || !authTag || !ciphertext) {
      throw new Error('Encrypted test fixture is malformed');
    }

    const modifiedCiphertext = Buffer.from(ciphertext, 'base64url');
    const firstByte = modifiedCiphertext.at(0);
    if (firstByte === undefined) {
      throw new Error('Encrypted test fixture has no ciphertext');
    }

    modifiedCiphertext[0] = firstByte ^ 1;
    const modified = [initializationVector, authTag, modifiedCiphertext.toString('base64url')].join('.');

    expect(() => decryptWebhookSecret(modified, encryptionKey)).toThrow();
  });

  it('signs the timestamp and exact request body', () => {
    const timestamp = 1_784_073_600;
    const body = '{"id":"event-id"}';
    const secret = 'signing-secret';
    const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

    expect(signWebhookPayload(timestamp, body, secret)).toBe(`sha256=${expected}`);
  });

  it('blocks local and carrier-grade NAT targets in cloud mode', async () => {
    await expect(assertWebhookUrl('https://localhost/hook', false)).rejects.toThrow(
      'Private webhook targets are not allowed'
    );
    await expect(assertWebhookUrl('https://100.127.1.234/hook', false)).rejects.toThrow(
      'Private webhook targets are not allowed'
    );
  });

  it('allows an explicit local HTTP target in self-hosted mode', async () => {
    const url = await assertWebhookUrl('http://localhost:8080/hook', true);

    expect(url.href).toBe('http://localhost:8080/hook');
  });
});
