/**
 * The candidate's display name, read without a cast.
 *
 * `safeServerApi` is called here without a success type, so `result.body` is `unknown`. Typing it
 * from the RPC contract resolves cleanly but surfaces four mismatches in the page that `unknown`
 * was hiding — jsonb columns arrive as `JSONValue`, and the paper's question shape does not match
 * what two helpers expect. That is its own piece of work; this reads only the one string the tab
 * needs, and checks it at runtime rather than asserting it.
 */
export function readCandidateName(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('data' in body)) return null;
  const { data } = body;
  if (typeof data !== 'object' || data === null || !('attempt' in data)) return null;
  const { attempt } = data;
  if (typeof attempt !== 'object' || attempt === null || !('displayName' in attempt)) return null;

  return typeof attempt.displayName === 'string' && attempt.displayName.trim() ? attempt.displayName : null;
}
