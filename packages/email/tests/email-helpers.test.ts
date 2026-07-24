import { OPERATOR_EMAIL, PRODUCT_NAME } from '@cio/utils/constants';
import { describe, expect, it } from 'vitest';

import {
  buildEmailFromName,
  escapeHtml,
  extractNameAndEmail,
  sanitizeEmailDisplayName,
  sanitizeEmailSubject
} from '../src/utils/functions/email-helpers';

// The quoting and angle brackets are spelled out because that shape is what
// these tests are about; the name and address inside come from the constants so
// a rebrand does not break a test that is not checking the brand. Their values
// are pinned by the product-identity tests.
const DEFAULT_FROM = `"${PRODUCT_NAME}" <${OPERATOR_EMAIL}>`;

describe('escapeHtml', () => {
  it('escapes HTML metacharacters', () => {
    expect(escapeHtml(`Tom & Jerry's "Lab"`)).toBe('Tom &amp; Jerry&#39;s &quot;Lab&quot;');
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('sanitizeEmailDisplayName', () => {
  it('strips control characters and trims whitespace', () => {
    expect(sanitizeEmailDisplayName('  Acme\r\nAcademy\u0000  ')).toBe('Acme Academy');
    expect(sanitizeEmailDisplayName('Acme\x01Academy\x7F')).toBe('Acme Academy');
  });

  it('backslash-escapes embedded quotes per RFC 5322 quoted-strings', () => {
    expect(sanitizeEmailDisplayName('Alice "Admin" Academy')).toBe('Alice \\"Admin\\" Academy');
  });

  it('escapes backslashes before quotes', () => {
    expect(sanitizeEmailDisplayName('Acme\\Corp "East"')).toBe('Acme\\\\Corp \\"East\\"');
  });
});

describe('sanitizeEmailSubject', () => {
  it('strips control characters and trims whitespace', () => {
    expect(sanitizeEmailSubject('  Invite to Acme\r\n\rAcademy\u0000  ')).toBe('Invite to Acme Academy');
    expect(sanitizeEmailSubject('Invite\x01to\x7FAcme')).toBe('Invite to Acme');
  });

  it('preserves quotes in subject text', () => {
    expect(sanitizeEmailSubject('Join "Acme" today')).toBe('Join "Acme" today');
  });
});

describe('extractNameAndEmail', () => {
  it('parses a quoted display name', () => {
    expect(extractNameAndEmail('"ClassroomHub" <noreply@classroom.io.vn>')).toEqual({
      name: 'ClassroomHub',
      email: 'noreply@classroom.io.vn'
    });
  });

  it('parses an unquoted display name', () => {
    // The shape a plain `SMTP_SENDER="ClassroomHub <noreply@host>"` produces. It
    // used to fall through to the "whole string is the address" branch.
    expect(extractNameAndEmail('ClassroomHub <noreply@classroom.io.vn>')).toEqual({
      name: 'ClassroomHub',
      email: 'noreply@classroom.io.vn'
    });
  });

  it('parses a bare address', () => {
    expect(extractNameAndEmail('noreply@classroom.io.vn')).toEqual({
      name: '',
      email: 'noreply@classroom.io.vn'
    });
  });

  it('unescapes a quoted display name', () => {
    expect(extractNameAndEmail('"Alice \\"Admin\\" Academy" <a@b.com>')).toEqual({
      name: 'Alice "Admin" Academy',
      email: 'a@b.com'
    });
  });

  it('rejects an already-nested header instead of guessing', () => {
    // Exactly what was observed in the dev mailbox before the fix. Callers fall
    // back to the configured sender rather than salvaging an address.
    expect(extractNameAndEmail('"Udemy Test (via ClassroomHub)" <ClassroomHub <noreply@localhost>>')).toBeUndefined();
  });

  it('returns undefined when there is no address to send to', () => {
    expect(extractNameAndEmail('ClassroomHub')).toBeUndefined();
    expect(extractNameAndEmail('')).toBeUndefined();
    expect(extractNameAndEmail('   ')).toBeUndefined();
  });
});

describe('buildEmailFromName', () => {
  it('does not nest brackets when the sender has an unquoted display name', () => {
    // Regression: an unquoted SMTP_SENDER produced
    // `"Org (via ClassroomHub)" <ClassroomHub <noreply@host>>`, which real providers
    // reject. The address must be extracted, not the whole header.
    const from = buildEmailFromName('Udemy Test (via ClassroomHub)');

    expect(from).not.toMatch(/<[^>]*</);
    expect(extractNameAndEmail(from)?.email).toBe('support@classroom.io.vn');
  });

  it('returns the default sender when name is missing or empty after sanitization', () => {
    expect(buildEmailFromName()).toBe(DEFAULT_FROM);
    expect(buildEmailFromName('')).toBe(DEFAULT_FROM);
    expect(buildEmailFromName('\r\n\u0000')).toBe(DEFAULT_FROM);
  });

  it('wraps a plain display name in a quoted From header', () => {
    expect(buildEmailFromName('Acme Academy (via ClassroomHub)')).toBe(
      '"Acme Academy (via ClassroomHub)" <support@classroom.io.vn>'
    );
  });

  it('sanitizes embedded quotes in the display name', () => {
    expect(buildEmailFromName('Alice "Admin" Academy (via ClassroomHub)')).toBe(
      '"Alice \\"Admin\\" Academy (via ClassroomHub)" <support@classroom.io.vn>'
    );
  });
});
