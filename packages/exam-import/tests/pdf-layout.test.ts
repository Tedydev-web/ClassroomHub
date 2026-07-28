import { describe, expect, it } from 'vitest';
import {
  inferPdfLines,
  inferPdfParagraphs,
  inferPdfTables,
  inferWeakPdfUnderlines,
  isPdfFontBold,
  normalizePdfFontName,
  orderPdfLines,
  positionPdfGlyphs,
  type PdfTextFragment
} from '../src/pdf/pdf-layout';

function fragment(sourceIndex: number, text: string, x: number, y: number, width = 40, height = 10): PdfTextFragment {
  const font = { name: 'Helvetica', bold: false, italic: false };
  const bounds = { x, y, width, height };

  return {
    ...bounds,
    pageIndex: 0,
    sourceIndex,
    text,
    fontName: font.name,
    bold: font.bold,
    italic: font.italic,
    color: null,
    hasEOL: true,
    glyphs: positionPdfGlyphs(text, bounds, font, null)
  };
}

function lineText(line: { fragments: PdfTextFragment[] }): string {
  return line.fragments.map((entry) => entry.text).join('');
}

describe('PDF font normalization', () => {
  it('removes a subset prefix before detecting bold', () => {
    expect(normalizePdfFontName('ABCDEF+TimesNewRomanPS-BoldMT')).toBe('TimesNewRomanPS-BoldMT');
    expect(isPdfFontBold('ABCDEF+TimesNewRomanPS-BoldMT')).toBe(true);
    expect(isPdfFontBold('ABCDEF+TimesNewRomanPS-BoldItalicMT')).toBe(true);
    expect(isPdfFontBold('TimesNewRomanPSMT')).toBe(false);
  });

  it('assigns a deterministic position to every glyph', () => {
    const glyphs = positionPdfGlyphs(
      'ABC',
      { x: 10, y: 20, width: 60, height: 12 },
      { name: 'Helvetica', bold: false, italic: false },
      '#112233',
      [1, 2, 3]
    );

    expect(glyphs.map((glyph) => glyph.x)).toEqual([10, 20, 40]);
    expect(glyphs.map((glyph) => glyph.width)).toEqual([10, 20, 30]);
    expect(glyphs.every((glyph) => glyph.color === '#112233')).toBe(true);
  });
});

describe('PDF reading order', () => {
  it('orders a single column from top to bottom', () => {
    const lines = inferPdfLines([fragment(1, 'Second', 50, 80), fragment(0, 'First', 50, 100)]);
    const ordered = orderPdfLines(lines, 600);

    expect(ordered.map(lineText)).toEqual(['First', 'Second']);
    expect(ordered.every((line) => line.column === 'single')).toBe(true);
  });

  it('reads the left column completely before the right column', () => {
    const lines = inferPdfLines([
      fragment(0, 'Heading', 50, 120, 500),
      fragment(1, 'Left 1', 50, 100, 180),
      fragment(2, 'Right 1', 350, 100, 180),
      fragment(3, 'Left 2', 50, 80, 180),
      fragment(4, 'Right 2', 350, 80, 180)
    ]);
    const ordered = orderPdfLines(lines, 600);

    expect(ordered.map(lineText)).toEqual(['Heading', 'Left 1', 'Left 2', 'Right 1', 'Right 2']);
  });

  it('infers paragraph boundaries from geometry and explicit starts', () => {
    const lines = inferPdfLines([
      fragment(0, 'A sentence', 50, 100),
      fragment(1, 'continues here', 50, 88),
      fragment(2, 'Question 2.', 50, 60)
    ]);
    const paragraphs = inferPdfParagraphs(orderPdfLines(lines, 600));

    expect(paragraphs.map((paragraph) => paragraph.lines.map(lineText))).toEqual([
      ['A sentence', 'continues here'],
      ['Question 2.']
    ]);
  });
});

describe('PDF inferred structures', () => {
  it('recognizes compact cells aligned across rows as a table', () => {
    const lines = inferPdfLines([
      fragment(0, '1', 50, 100, 8),
      fragment(1, 'A', 120, 100, 8),
      fragment(2, '2', 50, 80, 8),
      fragment(3, 'B', 120, 80, 8)
    ]);
    const tables = inferPdfTables(lines);

    expect(tables).toHaveLength(1);
    expect(tables[0]!.rows.map((row) => row.cells.map((cell) => lineText(cell)))).toEqual([
      ['1', 'A'],
      ['2', 'B']
    ]);
  });

  it('reports a nearby drawn line as weak underline metadata', () => {
    const text = fragment(0, 'Answer', 50, 100, 40, 10);
    const matches = inferWeakPdfUnderlines([text], [{ pageIndex: 0, x1: 50, y1: 98, x2: 90, y2: 98, width: 0.5 }]);

    expect(matches).toEqual([
      {
        fragmentSourceIndexes: [0],
        line: { pageIndex: 0, x1: 50, y1: 98, x2: 90, y2: 98, width: 0.5 }
      }
    ]);
  });
});
