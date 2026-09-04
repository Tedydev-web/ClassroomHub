/**
 * Postgres timestamps, made safe to hand to anything that parses dates.
 *
 * `timestamptz` comes back as `2026-09-02 15:41:41.278+00`: a space where the `T` should
 * be, and an offset with no minutes. Neither is in the grammar an engine is required to
 * accept, and V8 rejects the second outright — `new Date` answers `Invalid Date`, which is
 * how every clock cell in the answer workbook came out empty on sittings that had all of
 * them.
 *
 * It has now been the same two characters twice, in two different files. Normalising at the
 * point the value leaves the database is what stops it being a third.
 */
export function normaliseStamp(value: string | null): string | null {
  if (!value) return null;

  const iso = value.includes('T') ? value : value.replace(' ', 'T');
  const moment = new Date(/[+-]\d{2}$/u.test(iso) ? `${iso}:00` : iso);

  return Number.isNaN(moment.getTime()) ? null : moment.toISOString();
}
