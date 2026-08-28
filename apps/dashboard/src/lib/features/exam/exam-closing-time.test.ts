import { describe, expect, it } from 'vitest';

import { closingTimeAfterDays } from './exam-closing-time';

/**
 * The cases worth pinning are the ones where "add a day" and "add 86,400,000 milliseconds"
 * disagree: the end of a month, the end of a year, and a leap day.
 */
describe('closing an exam a number of days after it opens', () => {
  it('keeps the opening time of day', () => {
    const closes = closingTimeAfterDays('2026-08-28T07:30:00.000+07:00', 3);

    expect(new Date(closes as string).toISOString()).toBe(new Date('2026-08-31T07:30:00.000+07:00').toISOString());
  });

  it('rolls into the next month rather than off the end of this one', () => {
    const closes = closingTimeAfterDays('2026-08-30T09:00:00.000+07:00', 3);

    expect(new Date(closes as string).toISOString()).toBe(new Date('2026-09-02T09:00:00.000+07:00').toISOString());
  });

  it('rolls into the next year', () => {
    const closes = closingTimeAfterDays('2026-12-30T09:00:00.000+07:00', 5);

    expect(new Date(closes as string).toISOString()).toBe(new Date('2027-01-04T09:00:00.000+07:00').toISOString());
  });

  it('counts a leap day as a day', () => {
    const closes = closingTimeAfterDays('2028-02-28T09:00:00.000+07:00', 2);

    expect(new Date(closes as string).toISOString()).toBe(new Date('2028-03-01T09:00:00.000+07:00').toISOString());
  });

  it('has no answer without an opening time, or without a positive number of days', () => {
    expect(closingTimeAfterDays('', 3)).toBeNull();
    expect(closingTimeAfterDays('2026-08-28T07:30:00.000+07:00', 0)).toBeNull();
    expect(closingTimeAfterDays('2026-08-28T07:30:00.000+07:00', -1)).toBeNull();
    expect(closingTimeAfterDays('2026-08-28T07:30:00.000+07:00', Number.NaN)).toBeNull();
    expect(closingTimeAfterDays('not a date', 3)).toBeNull();
  });
});
