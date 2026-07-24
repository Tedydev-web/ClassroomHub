import { describe, expect, it } from 'vitest';
import { mapScormRuntime, parseScormDurationSeconds } from './runtime';

describe('parseScormDurationSeconds', () => {
  it('parses SCORM 1.2 time', () => {
    expect(parseScormDurationSeconds('0012:34:56.50', '1.2')).toBe(45_297);
  });

  it('parses SCORM 2004 duration', () => {
    expect(parseScormDurationSeconds('P1DT2H3M4.5S', '2004')).toBe(93_785);
  });

  it('returns zero for malformed values', () => {
    expect(parseScormDurationSeconds('not-a-duration', '2004')).toBe(0);
  });
});

describe('mapScormRuntime', () => {
  it('maps SCORM 1.2 passed state to completion', () => {
    expect(
      mapScormRuntime(
        {
          'cmi.core.lesson_status': 'passed',
          'cmi.core.score.raw': '88',
          'cmi.core.lesson_location': 'slide-4',
          'cmi.core.session_time': '00:10:00'
        },
        '1.2'
      )
    ).toMatchObject({
      completionStatus: 'completed',
      successStatus: 'passed',
      scoreRaw: 88,
      lastLocation: 'slide-4',
      sessionTimeSeconds: 600
    });
  });

  it('maps SCORM 2004 completion and scaled score', () => {
    expect(
      mapScormRuntime(
        {
          'cmi.completion_status': 'completed',
          'cmi.success_status': 'failed',
          'cmi.score.raw': '45',
          'cmi.score.scaled': '0.45',
          'cmi.session_time': 'PT5M'
        },
        '2004'
      )
    ).toMatchObject({
      completionStatus: 'completed',
      successStatus: 'failed',
      scoreRaw: 45,
      scoreScaled: 0.45,
      sessionTimeSeconds: 300
    });
  });
});
