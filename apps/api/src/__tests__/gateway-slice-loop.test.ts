import { describe, expect, it } from 'vitest';
import { computeSliceBounds } from '@cio/core/services/agent/gateway-slice-bounds';

const MAX_ROUNDS = 24;

describe('computeSliceBounds', () => {
  it('starts a fresh run at round zero', () => {
    const bounds = computeSliceBounds({
      roundsAlreadySpent: 0,
      sliceRounds: 3,
      maxWorkerRounds: MAX_ROUNDS
    });

    expect(bounds.startRound).toBe(0);
    expect(bounds.endRound).toBe(3);
    expect(bounds.isFinalSlice).toBe(false);
  });

  it('resumes from where the previous slice stopped', () => {
    const bounds = computeSliceBounds({
      roundsAlreadySpent: 6,
      sliceRounds: 3,
      maxWorkerRounds: MAX_ROUNDS
    });

    expect(bounds.startRound).toBe(6);
    expect(bounds.endRound).toBe(9);
  });

  it('never runs past the absolute per-run ceiling', () => {
    const bounds = computeSliceBounds({
      roundsAlreadySpent: 22,
      sliceRounds: 5,
      maxWorkerRounds: MAX_ROUNDS
    });

    expect(bounds.endRound).toBe(MAX_ROUNDS);
    expect(bounds.isFinalSlice).toBe(true);
  });

  it('marks the slice as final when it reaches the ceiling exactly', () => {
    const bounds = computeSliceBounds({
      roundsAlreadySpent: 21,
      sliceRounds: 3,
      maxWorkerRounds: MAX_ROUNDS
    });

    expect(bounds.endRound).toBe(MAX_ROUNDS);
    expect(bounds.isFinalSlice).toBe(true);
  });

  it('yields an empty slice once the ceiling is already reached', () => {
    const bounds = computeSliceBounds({
      roundsAlreadySpent: MAX_ROUNDS,
      sliceRounds: 3,
      maxWorkerRounds: MAX_ROUNDS
    });

    expect(bounds.startRound).toBe(MAX_ROUNDS);
    expect(bounds.endRound).toBe(MAX_ROUNDS);
    expect(bounds.isFinalSlice).toBe(true);
  });

  it('treats a corrupt negative cursor as a fresh start rather than failing', () => {
    const bounds = computeSliceBounds({
      roundsAlreadySpent: -5,
      sliceRounds: 3,
      maxWorkerRounds: MAX_ROUNDS
    });

    expect(bounds.startRound).toBe(0);
    expect(bounds.endRound).toBe(3);
  });

  it('treats a non-finite cursor as a fresh start', () => {
    const bounds = computeSliceBounds({
      roundsAlreadySpent: Number.NaN,
      sliceRounds: 3,
      maxWorkerRounds: MAX_ROUNDS
    });

    expect(bounds.startRound).toBe(0);
  });

  it('runs the whole budget in one slice when slicing is disabled', () => {
    // Official-API runs have no shared slot to be fair about, so they take the
    // full budget in a single lease rather than paying re-dispatch overhead.
    const bounds = computeSliceBounds({
      roundsAlreadySpent: 0,
      sliceRounds: MAX_ROUNDS,
      maxWorkerRounds: MAX_ROUNDS
    });

    expect(bounds.endRound).toBe(MAX_ROUNDS);
    expect(bounds.isFinalSlice).toBe(true);
  });

  it('coerces a zero slice size to at least one round so a run always progresses', () => {
    const bounds = computeSliceBounds({
      roundsAlreadySpent: 0,
      sliceRounds: 0,
      maxWorkerRounds: MAX_ROUNDS
    });

    expect(bounds.endRound).toBeGreaterThan(bounds.startRound);
  });

  it('reports a non-final slice when rounds remain, so the caller re-queues', () => {
    const bounds = computeSliceBounds({
      roundsAlreadySpent: 3,
      sliceRounds: 3,
      maxWorkerRounds: MAX_ROUNDS
    });

    expect(bounds.isFinalSlice).toBe(false);
  });
});
