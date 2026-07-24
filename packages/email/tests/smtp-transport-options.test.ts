import { describe, expect, it } from 'vitest';
import {
  createSmtpTransportOptions,
  parseSmtpBoolean,
  parseSmtpPort
} from '../src/utils/services/smtp-transport-options';

describe('createSmtpTransportOptions', () => {
  it('preserves production TLS defaults with credentials', () => {
    expect(
      createSmtpTransportOptions({ SMTP_HOST: 'smtp.example.com', SMTP_PASSWORD: 'secret', SMTP_USER: 'user' })
    ).toMatchObject({ secure: true, requireTLS: false, port: 465, auth: { user: 'user', pass: 'secret' } });

    expect(
      createSmtpTransportOptions({
        SMTP_HOST: 'smtp.example.com',
        SMTP_PASSWORD: 'secret',
        SMTP_PORT: '587',
        SMTP_USER: 'user'
      })
    ).toMatchObject({ secure: false, requireTLS: true, port: 587 });
  });

  it('supports explicitly authless non-TLS local SMTP', () => {
    expect(
      createSmtpTransportOptions({
        SMTP_HOST: 'localhost',
        SMTP_PORT: '1025',
        SMTP_REQUIRE_TLS: 'false',
        SMTP_SECURE: 'false'
      })
    ).toEqual({ host: 'localhost', port: 1025, secure: false, requireTLS: false });
  });

  it('rejects partial credentials and implicit authless SMTP', () => {
    expect(() => createSmtpTransportOptions({ SMTP_HOST: 'localhost', SMTP_USER: 'user' })).toThrow(
      'SMTP_USER and SMTP_PASSWORD must be configured together'
    );
    expect(() => createSmtpTransportOptions({ SMTP_HOST: 'localhost' })).toThrow('Authless SMTP requires explicit');
  });

  it('rejects invalid booleans and ports', () => {
    expect(() => parseSmtpBoolean('SMTP_SECURE', 'yes', false)).toThrow('SMTP_SECURE');
    expect(() => parseSmtpPort('70000')).toThrow('SMTP_PORT');
  });
});
