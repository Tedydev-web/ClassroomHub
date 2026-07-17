import type { AssessmentItemDefinition } from './assessment-item-schema';

/**
 * Stable serialization: recursively sorted object keys (byte order), arrays
 * order-significant, undefined-valued keys skipped (JSON.stringify parity).
 *
 * Content hashing stays server-side (node:crypto must not enter this
 * browser-bundled package); services hash this canonical string.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    const serialized = entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
    return `{${serialized.join(',')}}`;
  }

  throw new Error(`Cannot canonicalize a value of type ${typeof value}`);
}

export function canonicalizeAssessmentItemDefinition(definition: AssessmentItemDefinition): string {
  return stableStringify(definition);
}
