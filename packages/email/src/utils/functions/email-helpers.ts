import { FromData } from '../types';
import { EMAIL_FROM } from '../constants';

const EMAIL_HEADER_CONTROL_CHARS = /[\x00-\x1F\x7F]/g;

function stripEmailHeaderControlChars(value: string): string {
  return value.replace(EMAIL_HEADER_CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
}

/** Strip control chars and backslash-escape quotes for RFC 5322 quoted display names. */
export function sanitizeEmailDisplayName(name: string): string {
  const normalized = stripEmailHeaderControlChars(name);
  if (!normalized) {
    return '';
  }

  return normalized.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Strip control chars that could break or inject email headers. */
export function sanitizeEmailSubject(subject: string): string {
  return stripEmailHeaderControlChars(subject);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Address inside angle brackets, with an optional display name before it. */
const ANGLE_ADDRESS_PATTERN = /^(.*)<\s*([^<>\s]+@[^<>\s]+?)\s*>\s*$/;
const BARE_ADDRESS_PATTERN = /^[^<>\s]+@[^<>\s]+$/;

/** Unwrap an RFC 5322 quoted display name and undo its backslash escaping. */
function parseDisplayName(raw: string): string {
  const trimmed = raw.trim();
  const quoted = trimmed.match(/^"(.*)"$/s);
  const inner = quoted ? quoted[1].replace(/\\(["\\])/g, '$1') : trimmed;

  return stripEmailHeaderControlChars(inner);
}

/**
 * Parse a `From`/`Reply-To` header into its display name and address.
 *
 * Accepts `"Name" <a@b>`, `Name <a@b>`, and a bare `a@b`. Anything else —
 * including an already-nested `"A" <B <x@y>>` — returns undefined so callers
 * fall back to a known-good sender instead of guessing.
 *
 * A caller must never be handed an "address" that is really the whole header
 * string. That used to happen, and `buildEmailFromName` built
 * `"Org" <ClassroomHub <noreply@host>>` from it: a header Mailpit tolerates but
 * that real providers reject or spam-file.
 */
export function extractNameAndEmail(str: string): FromData | undefined {
  const value = stripEmailHeaderControlChars(str ?? '');

  if (!value) {
    return undefined;
  }

  const angleMatch = value.match(ANGLE_ADDRESS_PATTERN);
  if (angleMatch) {
    return { name: parseDisplayName(angleMatch[1]), email: angleMatch[2] };
  }

  if (BARE_ADDRESS_PATTERN.test(value)) {
    return { name: '', email: value };
  }

  return undefined;
}

export function buildEmailFromName(name?: string): string {
  if (!name) {
    return EMAIL_FROM;
  }

  const fromData = extractNameAndEmail(EMAIL_FROM);
  if (!fromData?.email) {
    return EMAIL_FROM;
  }

  const displayName = sanitizeEmailDisplayName(name);
  if (!displayName) {
    return EMAIL_FROM;
  }

  return `"${displayName}" <${fromData.email}>`;
}
