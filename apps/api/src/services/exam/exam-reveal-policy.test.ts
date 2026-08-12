import { describe, expect, it } from 'vitest';

import { isRevealed, type ExamRevealContext, type ExamRevealValue } from './exam-reveal-policy';

/**
 * One case per row of the policy table, including the configurations that cannot work.
 * Every decision is taken on the server; nothing here is ever evaluated in a browser.
 */

const BASE: ExamRevealContext = {
  now: new Date('2026-08-12T10:00:00.000Z'),
  attempt: { status: 'submitted', gradingState: 'complete', score: '8', total: '10' },
  exam: { closesAt: null, workingSeconds: null, revealThreshold: null }
};

type ContextOverrides = {
  now?: Date;
  attempt?: Partial<ExamRevealContext['attempt']>;
  exam?: Partial<ExamRevealContext['exam']>;
};

function ctx(overrides: ContextOverrides): ExamRevealContext {
  return {
    now: overrides.now ?? BASE.now,
    attempt: { ...BASE.attempt, ...(overrides.attempt ?? {}) },
    exam: { ...BASE.exam, ...(overrides.exam ?? {}) }
  };
}

function check(value: ExamRevealValue, context: ExamRevealContext) {
  return isRevealed(value, context);
}

describe('exam reveal policy', () => {
  it('never means never, whatever else is true', () => {
    expect(check('never', ctx({}))).toBe(false);
    expect(check('never', ctx({ attempt: { status: 'expired' } }))).toBe(false);
  });

  it('on_submit waits for the attempt to be finished', () => {
    expect(check('on_submit', ctx({ attempt: { status: 'in_progress' } }))).toBe(false);
    expect(check('on_submit', ctx({ attempt: { status: 'submitted' } }))).toBe(true);
    expect(check('on_submit', ctx({ attempt: { status: 'expired' } }))).toBe(true);
  });

  it('after_everyone waits for the window to close plus the working time', () => {
    const exam = { closesAt: '2026-08-12T09:00:00.000Z', workingSeconds: 3600 };

    // Closes at 09:00 plus an hour of working time is 10:00 — not yet at 09:59.
    expect(check('after_everyone', ctx({ exam, now: new Date('2026-08-12T09:59:00.000Z') }))).toBe(false);
    expect(check('after_everyone', ctx({ exam, now: new Date('2026-08-12T10:00:01.000Z') }))).toBe(true);
  });

  it('after_everyone stays shut when the exam has no closing time, rather than opening immediately', () => {
    expect(check('after_everyone', ctx({ exam: { closesAt: null, workingSeconds: 3600 } }))).toBe(false);
    expect(check('after_everyone', ctx({ exam: { closesAt: '2026-08-12T09:00:00.000Z', workingSeconds: null } }))).toBe(
      false
    );
  });

  it('above_threshold compares the finished score against the threshold', () => {
    const exam = { revealThreshold: '0.8' };

    expect(check('above_threshold', ctx({ exam, attempt: { score: '8', total: '10' } }))).toBe(true);
    expect(check('above_threshold', ctx({ exam, attempt: { score: '7', total: '10' } }))).toBe(false);
  });

  it('above_threshold does not fire on a partial score that is still awaiting marks', () => {
    const exam = { revealThreshold: '0.8' };

    expect(
      check('above_threshold', ctx({ exam, attempt: { gradingState: 'awaiting_manual', score: '9', total: '10' } }))
    ).toBe(false);
  });

  it('above_threshold stays shut without a threshold, and without a total to divide by', () => {
    expect(check('above_threshold', ctx({ exam: { revealThreshold: null } }))).toBe(false);
    expect(check('above_threshold', ctx({ exam: { revealThreshold: '0.8' }, attempt: { total: '0' } }))).toBe(false);
  });

  it('reveals nothing while the sitter is still working, whatever the setting', () => {
    const working = ctx({ attempt: { status: 'in_progress' } });

    for (const value of ['on_submit', 'after_everyone', 'above_threshold'] as ExamRevealValue[]) {
      expect(check(value, working)).toBe(false);
    }
  });
});
