import { describe, expect, it } from 'vitest';

import { PAPER_PADDING, RENDERER_ASSUMED_CHROME, workspaceChromeCorrection } from './exam-workspace-chrome';

describe('workspaceChromeCorrection', () => {
  it('gives height back on a phone, where this page costs less than the renderer assumes', () => {
    // Measured off the reported screenshot: an 88px header over a 60px bar. The renderer
    // was subtracting 224 + 60 for chrome that actually costs 88 + 60 + 40.
    const correction = workspaceChromeCorrection(88, 60);

    expect(correction).toBe(88 + 60 + PAPER_PADDING - RENDERER_ASSUMED_CHROME);
    expect(correction).toBeLessThan(0);
  });

  it('takes height away when this page really does carry more chrome', () => {
    // A tall header and a bar wrapped onto two lines. The correction has to work in both
    // directions or it is just a nudge that happens to help one screen.
    expect(workspaceChromeCorrection(140, 130)).toBeGreaterThan(0);
  });

  it('falls back to the action bar alone until both heights are measured', () => {
    // Both arrive as 0 on the first frame. Believing them would claim the page has no
    // chrome and stretch the workspace past the viewport for a frame.
    expect(workspaceChromeCorrection(0, 0)).toBe(0);
    expect(workspaceChromeCorrection(0, 60)).toBe(60);
    expect(workspaceChromeCorrection(88, 0)).toBe(0);
  });

  it('never claims more chrome than the two measured pieces plus their padding', () => {
    const header = 88;
    const bar = 60;

    expect(workspaceChromeCorrection(header, bar) + RENDERER_ASSUMED_CHROME).toBe(header + bar + PAPER_PADDING);
  });
});
