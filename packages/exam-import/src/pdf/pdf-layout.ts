export type PdfBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfGlyph = PdfBounds & {
  text: string;
  fontName: string;
  bold: boolean;
  italic: boolean;
  color: string | null;
};

export type PdfTextFragment = PdfBounds & {
  pageIndex: number;
  sourceIndex: number;
  text: string;
  fontName: string;
  bold: boolean;
  italic: boolean;
  color: string | null;
  hasEOL: boolean;
  glyphs: PdfGlyph[];
};

export type PdfLayoutLine = PdfBounds & {
  id: number;
  pageIndex: number;
  baseline: number;
  fragments: PdfTextFragment[];
};

export type PdfOrderedLine = PdfLayoutLine & {
  column: 'single' | 'left' | 'right' | 'spanning';
  rank: number;
};

export type PdfParagraph = {
  lines: PdfOrderedLine[];
};

export type PdfTableCell = {
  column: number;
  fragments: PdfTextFragment[];
};

export type PdfTableRow = {
  lineId: number;
  row: number;
  cells: PdfTableCell[];
};

export type PdfTable = {
  tableIndex: number;
  rows: PdfTableRow[];
};

export type PdfVectorLine = {
  pageIndex: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
};

export type PdfWeakUnderlineMatch = {
  fragmentSourceIndexes: number[];
  line: PdfVectorLine;
};

const SUBSET_FONT_PREFIX = /^[A-Z]{6}\+/u;
const BOLD_FONT_NAME =
  /(?:^|[-,\s])(?:bold|black|demi|semi[-\s]?bold|heavy)(?=(?:italic|oblique)?(?:mt)?(?:$|[-,\s]))/iu;
const ITALIC_FONT_NAME = /(?:italic|oblique)(?:mt)?(?:$|[-,\s])/iu;
const PARAGRAPH_START = /^(?:(?:question|câu)\s+\d+|(?:[A-Z]|\d+)[.)]\s+|(?:phần|section)\s+(?:[IVXLC]+|\d+))/iu;

function right(bounds: PdfBounds): number {
  return bounds.x + bounds.width;
}

function top(bounds: PdfBounds): number {
  return bounds.y + bounds.height;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((left, rightValue) => left - rightValue);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function boundsOf(fragments: PdfTextFragment[]): PdfBounds {
  const x = Math.min(...fragments.map((fragment) => fragment.x));
  const y = Math.min(...fragments.map((fragment) => fragment.y));
  const furthestRight = Math.max(...fragments.map(right));
  const furthestTop = Math.max(...fragments.map(top));

  return { x, y, width: furthestRight - x, height: furthestTop - y };
}

export function normalizePdfFontName(fontName: string): string {
  return fontName.replace(SUBSET_FONT_PREFIX, '');
}

export function isPdfFontBold(fontName: string): boolean {
  return BOLD_FONT_NAME.test(normalizePdfFontName(fontName));
}

export function isPdfFontItalic(fontName: string): boolean {
  return ITALIC_FONT_NAME.test(normalizePdfFontName(fontName));
}

export function positionPdfGlyphs(
  text: string,
  bounds: PdfBounds,
  font: { name: string; bold: boolean; italic: boolean },
  color: string | null,
  advances: number[] = []
): PdfGlyph[] {
  const characters = Array.from(text);
  if (characters.length === 0) return [];

  const usableAdvances =
    advances.length === characters.length && advances.every((advance) => Number.isFinite(advance) && advance > 0)
      ? advances
      : characters.map(() => 1);
  const totalAdvance = usableAdvances.reduce((total, advance) => total + advance, 0);
  let offset = 0;

  return characters.map((character, index) => {
    const width = bounds.width * (usableAdvances[index]! / totalAdvance);
    const glyph: PdfGlyph = {
      text: character,
      x: bounds.x + offset,
      y: bounds.y,
      width,
      height: bounds.height,
      fontName: font.name,
      bold: font.bold,
      italic: font.italic,
      color
    };
    offset += width;

    return glyph;
  });
}

export function inferPdfLines(fragments: PdfTextFragment[]): PdfLayoutLine[] {
  const lines: Array<{ baseline: number; fragments: PdfTextFragment[] }> = [];
  const orderedFragments = [...fragments].sort(
    (left, rightValue) => rightValue.y - left.y || left.x - rightValue.x || left.sourceIndex - rightValue.sourceIndex
  );

  for (const fragment of orderedFragments) {
    const matchingLine = lines.find((line) => {
      const lineHeight = median(line.fragments.map((entry) => entry.height));
      const tolerance = Math.max(1.5, Math.min(lineHeight, fragment.height) * 0.35);

      return Math.abs(line.baseline - fragment.y) <= tolerance;
    });

    if (matchingLine) {
      matchingLine.fragments.push(fragment);
      matchingLine.baseline =
        matchingLine.fragments.reduce((total, entry) => total + entry.y, 0) / matchingLine.fragments.length;
      continue;
    }

    lines.push({ baseline: fragment.y, fragments: [fragment] });
  }

  return lines
    .map((line) => {
      const lineFragments = [...line.fragments].sort(
        (left, rightValue) => left.x - rightValue.x || left.sourceIndex - rightValue.sourceIndex
      );
      const bounds = boundsOf(lineFragments);

      return {
        ...bounds,
        id: Math.min(...lineFragments.map((fragment) => fragment.sourceIndex)),
        pageIndex: lineFragments[0]!.pageIndex,
        baseline: line.baseline,
        fragments: lineFragments
      };
    })
    .sort((left, rightValue) => top(rightValue) - top(left) || left.x - rightValue.x || left.id - rightValue.id);
}

function detectColumnDivider(lines: PdfLayoutLine[], pageWidth: number): number | null {
  if (lines.length < 4) return null;

  const contentLeft = Math.min(...lines.map((line) => line.x));
  const contentRight = Math.max(...lines.map(right));
  const divider = (contentLeft + contentRight) / 2;
  const tolerance = Math.max(2, pageWidth * 0.005);
  const leftCount = lines.filter((line) => right(line) <= divider + tolerance).length;
  const rightCount = lines.filter((line) => line.x >= divider - tolerance).length;

  return leftCount >= 2 && rightCount >= 2 ? divider : null;
}

function splitWideColumnLine(line: PdfLayoutLine, pageWidth: number): PdfLayoutLine[] {
  if (line.fragments.length < 2) return [line];

  const fragments = [...line.fragments].sort(
    (left, rightValue) => left.x - rightValue.x || left.sourceIndex - rightValue.sourceIndex
  );
  const gaps = fragments.slice(1).map((fragment, index) => ({
    index: index + 1,
    width: fragment.x - right(fragments[index]!)
  }));
  const widestGap = gaps.sort((left, rightValue) => rightValue.width - left.width)[0];
  if (!widestGap || widestGap.width <= pageWidth * 0.08) return [line];

  const groups = [fragments.slice(0, widestGap.index), fragments.slice(widestGap.index)];
  const groupBounds = groups.map(boundsOf);
  if (groupBounds.some((bounds) => bounds.width < pageWidth * 0.1)) return [line];

  return groups.map((group) => {
    const bounds = boundsOf(group);

    return {
      ...bounds,
      id: Math.min(...group.map((fragment) => fragment.sourceIndex)),
      pageIndex: line.pageIndex,
      baseline: line.baseline,
      fragments: group
    };
  });
}

function classifyColumn(line: PdfLayoutLine, divider: number, pageWidth: number): PdfOrderedLine['column'] {
  const tolerance = Math.max(2, pageWidth * 0.005);
  if (right(line) <= divider + tolerance) return 'left';
  if (line.x >= divider - tolerance) return 'right';

  return 'spanning';
}

export function orderPdfLines(lines: PdfLayoutLine[], pageWidth: number): PdfOrderedLine[] {
  const topDown = lines
    .flatMap((line) => splitWideColumnLine(line, pageWidth))
    .sort((left, rightValue) => top(rightValue) - top(left) || left.x - rightValue.x || left.id - rightValue.id);
  const divider = detectColumnDivider(topDown, pageWidth);
  if (divider === null) {
    return topDown.map((line, rank) => ({ ...line, column: 'single', rank }));
  }

  const output: Array<Omit<PdfOrderedLine, 'rank'>> = [];
  let pending: Array<Omit<PdfOrderedLine, 'rank'>> = [];
  const flushColumns = (): void => {
    const leftLines = pending.filter((line) => line.column === 'left');
    const rightLines = pending.filter((line) => line.column === 'right');
    output.push(...leftLines, ...rightLines);
    pending = [];
  };

  for (const line of topDown) {
    const column = classifyColumn(line, divider, pageWidth);
    const orderedLine = { ...line, column };
    if (column === 'spanning') {
      flushColumns();
      output.push(orderedLine);
      continue;
    }

    pending.push(orderedLine);
  }
  flushColumns();

  return output.map((line, rank) => ({ ...line, rank }));
}

function startsParagraph(line: PdfOrderedLine): boolean {
  return PARAGRAPH_START.test(
    line.fragments
      .map((fragment) => fragment.text)
      .join('')
      .trim()
  );
}

export function inferPdfParagraphs(lines: PdfOrderedLine[]): PdfParagraph[] {
  const paragraphs: PdfParagraph[] = [];

  for (const line of lines) {
    const current = paragraphs.at(-1);
    const previousLine = current?.lines.at(-1);
    if (!current || !previousLine) {
      paragraphs.push({ lines: [line] });
      continue;
    }

    const verticalGap = previousLine.y - top(line);
    const typicalHeight = Math.max(previousLine.height, line.height);
    const indentDifference = Math.abs(previousLine.x - line.x);
    const newParagraph =
      line.rank !== previousLine.rank + 1 ||
      line.column !== previousLine.column ||
      verticalGap > typicalHeight * 0.9 ||
      indentDifference > typicalHeight * 1.5 ||
      startsParagraph(line);

    if (newParagraph) {
      paragraphs.push({ lines: [line] });
      continue;
    }

    current.lines.push(line);
  }

  return paragraphs;
}

function splitLineIntoCells(line: PdfLayoutLine): PdfTableCell[] {
  const fragments = [...line.fragments].sort(
    (left, rightValue) => left.x - rightValue.x || left.sourceIndex - rightValue.sourceIndex
  );
  const characterWidths = fragments
    .filter((fragment) => fragment.text.length > 0)
    .map((fragment) => fragment.width / Array.from(fragment.text).length);
  const minimumGap = Math.max(line.height * 1.25, median(characterWidths) * 3);
  const cells: PdfTextFragment[][] = [];

  for (const fragment of fragments) {
    const current = cells.at(-1);
    const previous = current?.at(-1);
    if (!current || !previous || fragment.x - right(previous) > minimumGap) {
      cells.push([fragment]);
      continue;
    }

    current.push(fragment);
  }

  return cells.map((cellFragments, column) => ({ column, fragments: cellFragments }));
}

function cellsAlign(leftCells: PdfTableCell[], rightCells: PdfTableCell[], tolerance: number): boolean {
  if (leftCells.length !== rightCells.length || leftCells.length < 2) return false;

  return leftCells.every(
    (cell, index) => Math.abs(cell.fragments[0]!.x - rightCells[index]!.fragments[0]!.x) <= tolerance
  );
}

function isCompactTable(rows: PdfTableRow[]): boolean {
  const texts = rows.flatMap((row) =>
    row.cells.map((cell) =>
      cell.fragments
        .map((fragment) => fragment.text)
        .join('')
        .trim()
    )
  );
  const compactCells = texts.filter((text) => text.length <= 24).length;

  return compactCells / texts.length >= 0.6;
}

export function inferPdfTables(lines: PdfLayoutLine[]): PdfTable[] {
  const topDown = [...lines].sort(
    (left, rightValue) => top(rightValue) - top(left) || left.x - rightValue.x || left.id - rightValue.id
  );
  const candidates = topDown.map((line) => ({ line, cells: splitLineIntoCells(line) }));
  const tables: PdfTable[] = [];
  let pending: Array<{ line: PdfLayoutLine; cells: PdfTableCell[] }> = [];

  const flush = (): void => {
    if (pending.length >= 2) {
      const rows = pending.map(({ line, cells }, row) => ({ lineId: line.id, row, cells }));
      if (isCompactTable(rows)) tables.push({ tableIndex: tables.length, rows });
    }
    pending = [];
  };

  for (const candidate of candidates) {
    if (candidate.cells.length < 2) {
      flush();
      continue;
    }

    const previous = pending.at(-1);
    if (!previous) {
      pending.push(candidate);
      continue;
    }

    const tolerance = Math.max(previous.line.height, candidate.line.height) * 0.75;
    const verticalGap = previous.line.y - top(candidate.line);
    if (
      verticalGap <= Math.max(previous.line.height, candidate.line.height) * 2.5 &&
      cellsAlign(previous.cells, candidate.cells, tolerance)
    ) {
      pending.push(candidate);
      continue;
    }

    flush();
    pending.push(candidate);
  }
  flush();

  return tables;
}

function horizontalOverlap(leftBounds: PdfBounds, rightBounds: PdfBounds): number {
  return Math.max(0, Math.min(right(leftBounds), right(rightBounds)) - Math.max(leftBounds.x, rightBounds.x));
}

export function inferWeakPdfUnderlines(
  fragments: PdfTextFragment[],
  vectorLines: PdfVectorLine[]
): PdfWeakUnderlineMatch[] {
  const matches: PdfWeakUnderlineMatch[] = [];

  for (const line of vectorLines) {
    const lineBounds: PdfBounds = {
      x: Math.min(line.x1, line.x2),
      y: Math.min(line.y1, line.y2),
      width: Math.abs(line.x2 - line.x1),
      height: Math.max(line.width, Math.abs(line.y2 - line.y1))
    };
    const matchingFragments = fragments.filter((fragment) => {
      if (fragment.pageIndex !== line.pageIndex || lineBounds.width === 0) return false;

      const underlineY = (line.y1 + line.y2) / 2;
      const belowBaseline = fragment.y - underlineY;
      const overlap = horizontalOverlap(fragment, lineBounds);

      return (
        belowBaseline >= -line.width &&
        belowBaseline <= fragment.height * 0.4 + line.width &&
        overlap / Math.min(fragment.width, lineBounds.width) >= 0.65
      );
    });
    if (matchingFragments.length === 0) continue;

    matches.push({
      fragmentSourceIndexes: matchingFragments.map((fragment) => fragment.sourceIndex),
      line
    });
  }

  return matches;
}
