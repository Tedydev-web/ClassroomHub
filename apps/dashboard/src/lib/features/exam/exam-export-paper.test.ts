import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { rememberedExamExportPaper, storeExamExportPaper } from './exam-export-preferences';

/**
 * The answer sheet may be printed on A4 or A5, with A5 the default: one candidate's sheet is
 * half a page, so a class is half the paper. These pin the two decisions that make that safe
 * — the default, and the fact that A5 is the A4 sheet scaled down whole rather than reflowed.
 */
describe('the exam export paper choice', () => {
  it('defaults to A5 when nothing is stored', () => {
    expect(rememberedExamExportPaper()).toBe('a5');
  });

  it('remembers the chosen paper across reads', () => {
    // The module reads through `window.localStorage`; the test environment has no window, so
    // a Map-backed one is stood up for the round trip a teacher's browser makes for real.
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value)
      }
    });

    storeExamExportPaper('a4');
    expect(rememberedExamExportPaper()).toBe('a4');

    storeExamExportPaper('a5');
    expect(rememberedExamExportPaper()).toBe('a5');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
});

/**
 * The one number the A5 sheet depends on: its zoom must shrink the A4-width sheet (190mm) to
 * inside A5's printable width (148mm paper − 2×7mm horizontal page margin = 134mm). Any larger
 * zoom and the framed sheet spills over the edge and pushes a second page per candidate. Read
 * from the print page so a hand-edit of either value that breaks the fit fails here rather
 * than in a teacher's PDF.
 */
describe('the A5 answer-sheet geometry', () => {
  const source = readFileSync('src/routes/(app)/courses/[id]/exams/[examId]/print/+page@.svelte', 'utf8');

  const A4_SHEET_WIDTH_MM = 190;
  const A5_PAPER_WIDTH_MM = 148;

  it('keeps the zoomed A4 sheet inside A5 printable width', () => {
    const zoom = Number(source.match(/a5:\s*\{[^}]*zoom:\s*([\d.]+)/)?.[1]);
    // The horizontal margin is the second value of `margin: '8mm 7mm'`, which is what the
    // page's printable width subtracts on each side.
    const horizontalMargin = Number(source.match(/a5:\s*\{[^}]*margin:\s*'\d+mm\s+(\d+)mm'/)?.[1]);

    expect(zoom).toBeGreaterThan(0);
    expect(horizontalMargin).toBeGreaterThan(0);

    const printableWidth = A5_PAPER_WIDTH_MM - 2 * horizontalMargin;
    expect(zoom * A4_SHEET_WIDTH_MM).toBeLessThanOrEqual(printableWidth);
  });
});
