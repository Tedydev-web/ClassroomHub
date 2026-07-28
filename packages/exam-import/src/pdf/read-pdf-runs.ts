import { getDocument, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { emptyFormatting, type BlockContext, type SourceLocation, type SourceRun } from '../source-run';
import {
  inferPdfLines,
  inferPdfParagraphs,
  inferPdfTables,
  inferWeakPdfUnderlines,
  isPdfFontBold,
  isPdfFontItalic,
  normalizePdfFontName,
  orderPdfLines,
  positionPdfGlyphs,
  type PdfBounds,
  type PdfOrderedLine,
  type PdfTextFragment
} from './pdf-layout';
import {
  extractPdfOperators,
  type PdfEmbeddedImage,
  type PdfOperatorWarningCode,
  type PdfPaintedCharacter
} from './pdf-operators';

export type PdfReadErrorCode = 'INVALID_PDF' | 'NO_TEXT_LAYER' | 'RESOURCE_LIMIT_EXCEEDED';

export const PDF_READ_LIMITS = {
  pages: 100,
  textItems: 100_000,
  characters: 10_000_000,
  operators: 500_000,
  images: 2_000,
  imagePixelBytes: 64 * 1024 * 1024
} as const;

export class PdfReadError extends Error {
  constructor(
    message: string,
    readonly code: PdfReadErrorCode,
    readonly pageCount: number,
    readonly extractedCharacterCount: number,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'PdfReadError';
  }
}

export type PdfReadWarningCode =
  | PdfOperatorWarningCode
  | 'FONT_DESCRIPTOR_UNAVAILABLE'
  | 'TEXT_COLOR_ALIGNMENT_FAILED'
  | 'WEAK_UNDERLINE_INFERRED'
  | 'TABLE_STRUCTURE_INFERRED'
  | 'IMAGE_TEXT_POSITION_APPROXIMATE';

export type PdfReadWarning = {
  code: PdfReadWarningCode;
  message: string;
  pageIndex: number;
  blockIndex: number | null;
};

export type PdfWeakEmphasis = {
  kind: 'underline';
  strength: 'weak';
  source: 'drawn_line';
  pageIndex: number;
  locations: SourceLocation[];
  line: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    width: number;
  };
};

export type PdfReadResult = {
  runs: SourceRun[];
  assets: PdfEmbeddedImage[];
  weakEmphasis: PdfWeakEmphasis[];
  warnings: PdfReadWarning[];
  pageCount: number;
};

type ExtractedPageText = {
  page: PDFPageProxy;
  pageIndex: number;
  width: number;
  content: PdfTextContent;
};

type PdfTextItem = {
  str: string;
  transform: unknown;
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
};

type PdfTextContent = {
  items: Array<PdfTextItem | { type: string; id: string }>;
};

type PdfFont = {
  name: string;
  bold: boolean;
  italic: boolean;
  descriptorAvailable: boolean;
};

type PaintMatch = {
  nextIndex: number;
  advances: number[];
  color: string | null;
  aligned: boolean;
};

type EmissionBlock = {
  rank: number;
  kind: BlockContext['kind'];
  fragments: PdfTextFragment[];
  tableRef: BlockContext['tableRef'];
};

const NON_WHITESPACE = /\S/gu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textItems(content: PdfTextContent): PdfTextItem[] {
  return content.items.filter((item): item is PdfTextItem => 'str' in item);
}

function extractedCharacters(content: PdfTextContent): number {
  return textItems(content).reduce((total, item) => total + (item.str.match(NON_WHITESPACE)?.length ?? 0), 0);
}

function pageWidth(page: PDFPageProxy): number {
  const view: unknown = page.view;
  if (
    Array.isArray(view) &&
    view.length >= 4 &&
    view.every((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry))
  ) {
    return Math.abs(view[2]! - view[0]!);
  }

  return page.getViewport({ scale: 1, dontFlip: true }).width;
}

function textBounds(item: PdfTextItem): PdfBounds | null {
  const transform: unknown = item.transform;
  if (
    !Array.isArray(transform) ||
    transform.length < 6 ||
    !transform.every((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry))
  ) {
    return null;
  }

  const transformHeight = Math.hypot(transform[2]!, transform[3]!);

  return {
    x: transform[4]!,
    y: transform[5]!,
    width: Math.abs(item.width),
    height: Math.max(Math.abs(item.height), transformHeight, 1)
  };
}

function readPdfFont(page: PDFPageProxy, internalName: string): PdfFont {
  const rawFont: unknown = page.commonObjs.has(internalName) ? page.commonObjs.get(internalName) : null;
  const record = isRecord(rawFont) ? rawFont : null;
  const descriptorName = record && typeof record.name === 'string' ? record.name : internalName;
  const name = normalizePdfFontName(descriptorName);
  const descriptorBold = record?.bold === true || record?.black === true;
  const descriptorItalic = record?.italic === true;

  return {
    name,
    bold: descriptorBold || isPdfFontBold(name),
    italic: descriptorItalic || isPdfFontItalic(name),
    descriptorAvailable: record !== null
  };
}

function isWhitespace(value: string): boolean {
  return value.trim().length === 0;
}

function matchPaintedCharacters(text: string, painted: PdfPaintedCharacter[], startIndex: number): PaintMatch {
  const characters = Array.from(text);
  const advances: number[] = [];
  const colors: Array<string | null> = [];
  let paintedIndex = startIndex;

  for (const character of characters) {
    if (isWhitespace(character)) {
      if (painted[paintedIndex] && isWhitespace(painted[paintedIndex]!.text)) {
        advances.push(painted[paintedIndex]!.advance);
        paintedIndex += 1;
      } else {
        advances.push(1);
      }
      continue;
    }

    while (painted[paintedIndex] && isWhitespace(painted[paintedIndex]!.text)) paintedIndex += 1;
    const candidate = painted[paintedIndex];
    if (!candidate || candidate.text.normalize('NFC') !== character.normalize('NFC')) {
      return {
        nextIndex: startIndex,
        advances: characters.map(() => 1),
        color: null,
        aligned: false
      };
    }

    advances.push(candidate.advance);
    colors.push(candidate.color);
    paintedIndex += 1;
  }

  const firstColor = colors[0] ?? null;
  const color = colors.every((entry) => entry === firstColor) ? firstColor : null;

  return { nextIndex: paintedIndex, advances, color, aligned: true };
}

function fragmentText(fragment: PdfTextFragment, previous: PdfTextFragment | null, lineBreak: boolean): string {
  if (previous === null || /^\s/u.test(fragment.text) || /\s$/u.test(previous.text)) return fragment.text;
  if (lineBreak) return ` ${fragment.text}`;

  const previousCharacterWidth = previous.text.length === 0 ? 0 : previous.width / Array.from(previous.text).length;
  const gap = fragment.x - (previous.x + previous.width);

  return gap > Math.max(0.5, previousCharacterWidth * 0.2) ? ` ${fragment.text}` : fragment.text;
}

function orderedFragments(lines: PdfOrderedLine[]): PdfTextFragment[] {
  return lines.flatMap((line) => line.fragments);
}

function pageEmissionBlocks(orderedLines: PdfOrderedLine[]): { blocks: EmissionBlock[]; tableCount: number } {
  const tables = inferPdfTables(orderedLines);
  const tableLineIds = new Set(tables.flatMap((table) => table.rows.map((row) => row.lineId)));
  const rankByLineId = new Map(orderedLines.map((line) => [line.id, line.rank]));
  const blocks: EmissionBlock[] = [];

  for (const table of tables) {
    for (const row of table.rows) {
      const rank = rankByLineId.get(row.lineId);
      if (rank === undefined) continue;

      for (const cell of row.cells) {
        blocks.push({
          rank: rank + cell.column / 1_000,
          kind: 'table_cell',
          fragments: cell.fragments,
          tableRef: {
            tableIndex: table.tableIndex,
            row: row.row,
            column: cell.column,
            originRow: row.row,
            originColumn: cell.column
          }
        });
      }
    }
  }

  const paragraphs = inferPdfParagraphs(orderedLines.filter((line) => !tableLineIds.has(line.id)));
  for (const paragraph of paragraphs) {
    blocks.push({
      rank: paragraph.lines[0]!.rank,
      kind: 'paragraph',
      fragments: orderedFragments(paragraph.lines),
      tableRef: null
    });
  }

  blocks.sort((left, right) => left.rank - right.rank);

  return { blocks, tableCount: tables.length };
}

function appendTextBlock(
  output: SourceRun[],
  locationsBySourceIndex: Map<number, SourceLocation>,
  blockIndex: number,
  block: EmissionBlock,
  tableIndexOffset: number
): void {
  const tableRef =
    block.tableRef === null ? null : { ...block.tableRef, tableIndex: block.tableRef.tableIndex + tableIndexOffset };
  const context: BlockContext = {
    kind: block.kind,
    index: blockIndex,
    listNumber: null,
    tableRef
  };
  let previous: PdfTextFragment | null = null;

  block.fragments.forEach((fragment, runIndex) => {
    const lineBreak =
      previous !== null && Math.abs(previous.y - fragment.y) > Math.min(previous.height, fragment.height) * 0.35;
    const location = { blockIndex, runIndex };
    output.push({
      text: fragmentText(fragment, previous, lineBreak),
      formatting: {
        ...emptyFormatting(),
        bold: fragment.bold,
        italic: fragment.italic,
        color: fragment.color
      },
      block: context,
      math: null,
      image: null,
      location
    });
    locationsBySourceIndex.set(fragment.sourceIndex, location);
    previous = fragment;
  });
}

function appendImageBlocks(output: SourceRun[], images: PdfEmbeddedImage[], firstBlockIndex: number): void {
  const orderedImages = [...images].sort(
    (left, right) =>
      right.bounds.y + right.bounds.height - (left.bounds.y + left.bounds.height) ||
      left.bounds.x - right.bounds.x ||
      (left.assetRef < right.assetRef ? -1 : left.assetRef > right.assetRef ? 1 : 0)
  );

  orderedImages.forEach((asset, index) => {
    const blockIndex = firstBlockIndex + index;
    const block: BlockContext = {
      kind: 'paragraph',
      index: blockIndex,
      listNumber: null,
      tableRef: null
    };
    output.push({
      text: '',
      formatting: emptyFormatting(),
      block,
      math: null,
      image: {
        assetRef: asset.assetRef,
        width: asset.bounds.width,
        height: asset.bounds.height,
        placement: 'floating'
      },
      location: { blockIndex, runIndex: 0 }
    });
  });
}

export async function readPdfRuns(data: Uint8Array): Promise<PdfReadResult> {
  const loadingTask = getDocument({
    data: Uint8Array.from(data),
    disableAutoFetch: true,
    disableRange: true,
    disableStream: true,
    disableFontFace: true,
    fontExtraProperties: true,
    stopAtErrors: true,
    useSystemFonts: false,
    useWasm: false,
    useWorkerFetch: false,
    verbosity: 0
  });
  let pageCount = 0;
  let characterCount = 0;
  const loadedPages: PDFPageProxy[] = [];

  try {
    const documentProxy = await loadingTask.promise;
    pageCount = documentProxy.numPages;
    if (pageCount > PDF_READ_LIMITS.pages) {
      throw new PdfReadError(
        `PDF exceeds the ${PDF_READ_LIMITS.pages}-page processing limit`,
        'RESOURCE_LIMIT_EXCEEDED',
        pageCount,
        characterCount
      );
    }
    const pages: ExtractedPageText[] = [];
    let textItemCount = 0;

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await documentProxy.getPage(pageNumber);
      loadedPages.push(page);
      const content = await page.getTextContent();
      textItemCount += content.items.length;
      characterCount += extractedCharacters(content);
      if (textItemCount > PDF_READ_LIMITS.textItems || characterCount > PDF_READ_LIMITS.characters) {
        page.cleanup();
        for (const extractedPage of pages) extractedPage.page.cleanup();

        throw new PdfReadError(
          'PDF text layer exceeds the processing budget',
          'RESOURCE_LIMIT_EXCEEDED',
          pageCount,
          characterCount
        );
      }
      pages.push({ page, pageIndex: pageNumber - 1, width: pageWidth(page), content });
    }

    if (characterCount === 0) {
      for (const page of pages) page.page.cleanup();

      throw new PdfReadError(
        `PDF has no extractable text layer across ${pageCount} page(s)`,
        'NO_TEXT_LAYER',
        pageCount,
        characterCount
      );
    }

    const runs: SourceRun[] = [];
    const assets: PdfEmbeddedImage[] = [];
    const weakEmphasis: PdfWeakEmphasis[] = [];
    const warnings: PdfReadWarning[] = [];
    const locationsBySourceIndex = new Map<number, SourceLocation>();
    let nextSourceIndex = 0;
    let nextBlockIndex = 0;
    let nextTableIndex = 0;
    let operatorCount = 0;
    let imageCount = 0;
    let imagePixelBytes = 0;

    for (const extractedPage of pages) {
      const operatorList = await extractedPage.page.getOperatorList();
      operatorCount += operatorList.fnArray.length;
      if (operatorCount > PDF_READ_LIMITS.operators) {
        throw new PdfReadError(
          'PDF graphics operators exceed the processing budget',
          'RESOURCE_LIMIT_EXCEEDED',
          pageCount,
          characterCount
        );
      }
      const operators = extractPdfOperators(extractedPage.page, extractedPage.pageIndex, operatorList);
      imageCount += operators.images.length;
      imagePixelBytes += operators.images.reduce((total, image) => total + (image.pixels?.byteLength ?? 0), 0);
      if (imageCount > PDF_READ_LIMITS.images || imagePixelBytes > PDF_READ_LIMITS.imagePixelBytes) {
        throw new PdfReadError(
          'PDF embedded images exceed the processing budget',
          'RESOURCE_LIMIT_EXCEEDED',
          pageCount,
          characterCount
        );
      }
      warnings.push(
        ...operators.warnings.map((warning) => ({
          ...warning,
          blockIndex: null
        }))
      );

      const fragments: PdfTextFragment[] = [];
      let paintIndex = 0;
      let colorAlignmentFailed = false;
      const unresolvedFonts = new Set<string>();

      for (const item of textItems(extractedPage.content)) {
        if (item.str.length === 0) continue;

        const bounds = textBounds(item);
        if (bounds === null) continue;

        const paint = matchPaintedCharacters(item.str, operators.paintedCharacters, paintIndex);
        if (paint.aligned) {
          paintIndex = paint.nextIndex;
        } else {
          colorAlignmentFailed = true;
        }

        const font = readPdfFont(extractedPage.page, item.fontName);
        if (!font.descriptorAvailable) unresolvedFonts.add(item.fontName);
        const glyphs = positionPdfGlyphs(item.str, bounds, font, paint.color, paint.advances);
        fragments.push({
          ...bounds,
          pageIndex: extractedPage.pageIndex,
          sourceIndex: nextSourceIndex,
          text: item.str,
          fontName: font.name,
          bold: font.bold,
          italic: font.italic,
          color: paint.color,
          hasEOL: item.hasEOL,
          glyphs
        });
        nextSourceIndex += 1;
      }

      if (colorAlignmentFailed) {
        warnings.push({
          code: 'TEXT_COLOR_ALIGNMENT_FAILED',
          message: `Page ${extractedPage.pageIndex + 1} text could not be fully aligned with PDF paint operations`,
          pageIndex: extractedPage.pageIndex,
          blockIndex: null
        });
      }
      for (const fontName of [...unresolvedFonts].sort()) {
        warnings.push({
          code: 'FONT_DESCRIPTOR_UNAVAILABLE',
          message: `Page ${extractedPage.pageIndex + 1} font ${fontName} has no resolved descriptor`,
          pageIndex: extractedPage.pageIndex,
          blockIndex: null
        });
      }

      const lines = inferPdfLines(fragments);
      const orderedLines = orderPdfLines(lines, extractedPage.width);
      const emission = pageEmissionBlocks(orderedLines);
      const pageBlockStart = nextBlockIndex;
      for (const block of emission.blocks) {
        appendTextBlock(runs, locationsBySourceIndex, nextBlockIndex, block, nextTableIndex);
        nextBlockIndex += 1;
      }

      if (emission.tableCount > 0) {
        warnings.push({
          code: 'TABLE_STRUCTURE_INFERRED',
          message: `Page ${extractedPage.pageIndex + 1} contains ${emission.tableCount} table-like aligned region(s)`,
          pageIndex: extractedPage.pageIndex,
          blockIndex: pageBlockStart
        });
      }
      nextTableIndex += emission.tableCount;

      const underlineMatches = inferWeakPdfUnderlines(fragments, operators.vectorLines);
      for (const match of underlineMatches) {
        const locations = match.fragmentSourceIndexes.flatMap((sourceIndex) => {
          const location = locationsBySourceIndex.get(sourceIndex);

          return location ? [location] : [];
        });
        if (locations.length === 0) continue;

        weakEmphasis.push({
          kind: 'underline',
          strength: 'weak',
          source: 'drawn_line',
          pageIndex: extractedPage.pageIndex,
          locations,
          line: {
            x1: match.line.x1,
            y1: match.line.y1,
            x2: match.line.x2,
            y2: match.line.y2,
            width: match.line.width
          }
        });
      }
      if (underlineMatches.length > 0) {
        warnings.push({
          code: 'WEAK_UNDERLINE_INFERRED',
          message: `Page ${extractedPage.pageIndex + 1} contains drawn-line underline candidates retained as weak metadata`,
          pageIndex: extractedPage.pageIndex,
          blockIndex: pageBlockStart
        });
      }

      appendImageBlocks(runs, operators.images, nextBlockIndex);
      if (operators.images.length > 0) {
        warnings.push({
          code: 'IMAGE_TEXT_POSITION_APPROXIMATE',
          message: `Page ${extractedPage.pageIndex + 1} image runs retain exact page bounds but approximate text-flow position`,
          pageIndex: extractedPage.pageIndex,
          blockIndex: nextBlockIndex
        });
      }
      nextBlockIndex += operators.images.length;
      assets.push(...operators.images);
      extractedPage.page.cleanup();
    }

    return { runs, assets, weakEmphasis, warnings, pageCount };
  } catch (error) {
    if (error instanceof PdfReadError) throw error;

    throw new PdfReadError('PDF could not be parsed', 'INVALID_PDF', pageCount, characterCount, {
      cause: error instanceof Error ? error : new Error('Unknown PDF parsing failure')
    });
  } finally {
    for (const page of loadedPages) page.cleanup();
    await loadingTask.destroy();
  }
}
