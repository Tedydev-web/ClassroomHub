import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseWindowStamp } from './exam-window';

/** Exactly what `GET /exam/:examId` answers with, read from the running database. */
const POSTGRES_STAMP = '2026-09-07 03:00:00+00';

/**
 * Regression: the settings tab drew an empty opening and closing time for an exam that
 * had both.
 *
 * The loader swapped the space for a `T` and stopped there, which turns a string V8
 * accepts into one it rejects: the offset Postgres writes is `+00`, and the grammar wants
 * `+00:00`. Both fields parsed to `Invalid Date`, the loader answered null for each, and
 * `datetime-local` drew `dd/mm/yyyy, --:--` over a window a teacher had set.
 */
describe('the exam settings window', () => {
  it('survives the shape Postgres actually returns', () => {
    const parsed = parseWindowStamp(POSTGRES_STAMP);

    expect(parsed).not.toBeNull();
    expect(parsed?.toISOString()).toBe('2026-09-07T03:00:00.000Z');
  });

  it('is what a half-normalised stamp costs', () => {
    // The bug itself, pinned: this is why swapping only the space is not enough.
    expect(Number.isNaN(new Date(POSTGRES_STAMP.replace(' ', 'T')).getTime())).toBe(true);
  });

  it('is parsed by the loader rather than by a second copy of the rule', () => {
    const loader = readFileSync('src/routes/(app)/courses/[id]/exams/[examId]/+page.server.ts', 'utf8');

    expect(loader).toContain('parseWindowStamp');
    expect(loader).not.toMatch(/replace\(' ', 'T'\)/);
  });
});
