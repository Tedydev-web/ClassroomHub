import { ImageKind, OPS, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PdfBounds, PdfVectorLine } from './pdf-layout';

export type PdfPaintedCharacter = {
  text: string;
  advance: number;
  color: string | null;
};

export type PdfImagePixelFormat = 'grayscale-1bpp' | 'rgb-24bpp' | 'rgba-32bpp';

export type PdfEmbeddedImage = {
  assetRef: string;
  pageIndex: number;
  bounds: PdfBounds;
  intrinsicWidth: number;
  intrinsicHeight: number;
  pixels: Uint8Array | null;
  pixelFormat: PdfImagePixelFormat | null;
};

export type PdfOperatorWarningCode = 'IMAGE_DATA_UNAVAILABLE' | 'IMAGE_OPERATOR_UNSUPPORTED';

export type PdfOperatorWarning = {
  code: PdfOperatorWarningCode;
  message: string;
  pageIndex: number;
};

export type PdfOperatorExtraction = {
  paintedCharacters: PdfPaintedCharacter[];
  vectorLines: PdfVectorLine[];
  images: PdfEmbeddedImage[];
  warnings: PdfOperatorWarning[];
};

type PdfMatrix = [number, number, number, number, number, number];

type PdfOperatorList = {
  fnArray: number[];
  argsArray: unknown[];
};

type GraphicsState = {
  transform: PdfMatrix;
  fillColor: string | null;
  strokeColor: string | null;
  lineWidth: number;
  textRenderingMode: number;
  currentPoint: { x: number; y: number } | null;
  pathLines: PdfVectorLine[];
};

const IDENTITY_MATRIX: PdfMatrix = [1, 0, 0, 1, 0, 0];
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberAt(values: unknown[], index: number): number | null {
  const value = values[index];

  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function numericSequence(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry));
  }
  if (value instanceof Float32Array || value instanceof Float64Array) return Array.from(value);
  if (!isRecord(value)) return [];

  return Object.entries(value)
    .filter(([key, entry]) => /^\d+$/u.test(key) && typeof entry === 'number' && Number.isFinite(entry))
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([, entry]) => entry as number);
}

function multiplyMatrix(left: PdfMatrix, right: PdfMatrix): PdfMatrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5]
  ];
}

function transformPoint(matrix: PdfMatrix, x: number, y: number): { x: number; y: number } {
  return {
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5]
  };
}

function transformedBounds(matrix: PdfMatrix, x1: number, y1: number, x2: number, y2: number): PdfBounds {
  const points = [
    transformPoint(matrix, x1, y1),
    transformPoint(matrix, x2, y1),
    transformPoint(matrix, x1, y2),
    transformPoint(matrix, x2, y2)
  ];
  const x = Math.min(...points.map((point) => point.x));
  const y = Math.min(...points.map((point) => point.y));
  const furthestRight = Math.max(...points.map((point) => point.x));
  const furthestTop = Math.max(...points.map((point) => point.y));

  return { x, y, width: furthestRight - x, height: furthestTop - y };
}

function transformScale(matrix: PdfMatrix): number {
  const horizontal = Math.hypot(matrix[0], matrix[1]);
  const vertical = Math.hypot(matrix[2], matrix[3]);

  return (horizontal + vertical) / 2;
}

function readHexColor(value: unknown): string | null {
  if (typeof value === 'string') return HEX_COLOR.test(value) ? value.toUpperCase() : null;
  if (!Array.isArray(value)) return null;

  for (const entry of value) {
    const color = readHexColor(entry);
    if (color !== null) return color;
  }

  return null;
}

function paintedColor(state: GraphicsState): string | null {
  if (state.textRenderingMode === 3) return null;
  if (state.textRenderingMode === 1 || state.textRenderingMode === 5) return state.strokeColor;

  return state.fillColor;
}

function paintedCharacters(value: unknown, color: string | null): PdfPaintedCharacter[] {
  if (Array.isArray(value)) return value.flatMap((entry) => paintedCharacters(entry, color));
  if (!isRecord(value) || typeof value.unicode !== 'string') return [];

  const characters = Array.from(value.unicode);
  if (characters.length === 0) return [];

  const width = typeof value.width === 'number' && value.width > 0 ? value.width : characters.length;

  return characters.map((character) => ({
    text: character,
    advance: width / characters.length,
    color
  }));
}

function isStrokeOperation(operation: number): boolean {
  return (
    operation === OPS.stroke ||
    operation === OPS.closeStroke ||
    operation === OPS.fillStroke ||
    operation === OPS.eoFillStroke ||
    operation === OPS.closeFillStroke ||
    operation === OPS.closeEOFillStroke
  );
}

function isFillOperation(operation: number): boolean {
  return (
    operation === OPS.fill ||
    operation === OPS.eoFill ||
    operation === OPS.fillStroke ||
    operation === OPS.eoFillStroke ||
    operation === OPS.closeFillStroke ||
    operation === OPS.closeEOFillStroke
  );
}

function thinHorizontalLine(pageIndex: number, bounds: PdfBounds, lineWidth: number): PdfVectorLine | null {
  const effectiveHeight = Math.max(bounds.height, lineWidth);
  if (bounds.width < effectiveHeight * 2 || effectiveHeight > 6) return null;

  const y = bounds.y + bounds.height / 2;

  return {
    pageIndex,
    x1: bounds.x,
    y1: y,
    x2: bounds.x + bounds.width,
    y2: y,
    width: effectiveHeight
  };
}

function recordConstructedPath(
  pageIndex: number,
  args: unknown[],
  state: GraphicsState,
  output: PdfVectorLine[]
): void {
  const paintOperation = numberAt(args, 0);
  const box = numericSequence(args[2]);
  if (paintOperation === null || box.length < 4) return;
  if (!isStrokeOperation(paintOperation) && !isFillOperation(paintOperation)) return;

  const bounds = transformedBounds(state.transform, box[0]!, box[1]!, box[2]!, box[3]!);
  const lineWidth = state.lineWidth * transformScale(state.transform);
  const line = thinHorizontalLine(pageIndex, bounds, lineWidth);
  if (line !== null) output.push(line);
}

function cloneState(state: GraphicsState): GraphicsState {
  return {
    ...state,
    transform: [...state.transform],
    currentPoint: state.currentPoint === null ? null : { ...state.currentPoint },
    pathLines: [...state.pathLines]
  };
}

function imagePixelFormat(kind: unknown): PdfImagePixelFormat | null {
  if (kind === ImageKind.GRAYSCALE_1BPP) return 'grayscale-1bpp';
  if (kind === ImageKind.RGB_24BPP) return 'rgb-24bpp';
  if (kind === ImageKind.RGBA_32BPP) return 'rgba-32bpp';

  return null;
}

function imageObject(page: PDFPageProxy, objectId: string): unknown {
  if (page.objs.has(objectId)) return page.objs.get(objectId);
  if (page.commonObjs.has(objectId)) return page.commonObjs.get(objectId);

  return null;
}

function bytePixels(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array || value instanceof Uint8ClampedArray) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }

  return null;
}

function readImage(
  pageIndex: number,
  imageIndex: number,
  state: GraphicsState,
  value: unknown,
  fallbackWidth: number | null,
  fallbackHeight: number | null
): PdfEmbeddedImage {
  const record = isRecord(value) ? value : {};
  const width = typeof record.width === 'number' && record.width > 0 ? record.width : Math.max(1, fallbackWidth ?? 1);
  const height =
    typeof record.height === 'number' && record.height > 0 ? record.height : Math.max(1, fallbackHeight ?? 1);
  const bounds = transformedBounds(state.transform, 0, 0, 1, 1);
  const pixels = bytePixels(record.data);

  return {
    assetRef: `pdf-image-${pageIndex}-${imageIndex}`,
    pageIndex,
    bounds,
    intrinsicWidth: width,
    intrinsicHeight: height,
    pixels,
    pixelFormat: imagePixelFormat(record.kind)
  };
}

export function extractPdfOperators(
  page: PDFPageProxy,
  pageIndex: number,
  operatorList: PdfOperatorList
): PdfOperatorExtraction {
  const painted: PdfPaintedCharacter[] = [];
  const vectorLines: PdfVectorLine[] = [];
  const images: PdfEmbeddedImage[] = [];
  const warnings: PdfOperatorWarning[] = [];
  const stack: GraphicsState[] = [];
  let state: GraphicsState = {
    transform: [...IDENTITY_MATRIX],
    fillColor: '#000000',
    strokeColor: '#000000',
    lineWidth: 1,
    textRenderingMode: 0,
    currentPoint: null,
    pathLines: []
  };

  operatorList.fnArray.forEach((operation, operationIndex) => {
    const rawArgs: unknown = operatorList.argsArray[operationIndex];
    const args = Array.isArray(rawArgs) ? rawArgs : [];

    if (operation === OPS.save) {
      stack.push(cloneState(state));
      return;
    }
    if (operation === OPS.restore) {
      state = stack.pop() ?? state;
      return;
    }
    if (operation === OPS.transform) {
      const matrix = args.slice(0, 6);
      if (matrix.every((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry))) {
        state.transform = multiplyMatrix(state.transform, matrix as PdfMatrix);
      }
      return;
    }
    if (
      operation === OPS.setFillRGBColor ||
      operation === OPS.setFillGray ||
      operation === OPS.setFillCMYKColor ||
      operation === OPS.setFillColor
    ) {
      state.fillColor = readHexColor(args);
      return;
    }
    if (operation === OPS.setFillColorN) {
      state.fillColor = null;
      return;
    }
    if (
      operation === OPS.setStrokeRGBColor ||
      operation === OPS.setStrokeGray ||
      operation === OPS.setStrokeCMYKColor ||
      operation === OPS.setStrokeColor
    ) {
      state.strokeColor = readHexColor(args);
      return;
    }
    if (operation === OPS.setStrokeColorN) {
      state.strokeColor = null;
      return;
    }
    if (operation === OPS.setLineWidth) {
      state.lineWidth = numberAt(args, 0) ?? state.lineWidth;
      return;
    }
    if (operation === OPS.setTextRenderingMode) {
      state.textRenderingMode = numberAt(args, 0) ?? state.textRenderingMode;
      return;
    }
    if (
      operation === OPS.showText ||
      operation === OPS.showSpacedText ||
      operation === OPS.nextLineShowText ||
      operation === OPS.nextLineSetSpacingShowText
    ) {
      painted.push(...paintedCharacters(args, paintedColor(state)));
      return;
    }
    if (operation === OPS.constructPath) {
      recordConstructedPath(pageIndex, args, state, vectorLines);
      return;
    }
    if (operation === OPS.moveTo) {
      const x = numberAt(args, 0);
      const y = numberAt(args, 1);
      if (x !== null && y !== null) state.currentPoint = { x, y };
      return;
    }
    if (operation === OPS.lineTo) {
      const x = numberAt(args, 0);
      const y = numberAt(args, 1);
      if (state.currentPoint !== null && x !== null && y !== null) {
        const start = transformPoint(state.transform, state.currentPoint.x, state.currentPoint.y);
        const end = transformPoint(state.transform, x, y);
        state.pathLines.push({
          pageIndex,
          x1: start.x,
          y1: start.y,
          x2: end.x,
          y2: end.y,
          width: state.lineWidth * transformScale(state.transform)
        });
        state.currentPoint = { x, y };
      }
      return;
    }
    if (
      operation === OPS.stroke ||
      operation === OPS.closeStroke ||
      operation === OPS.fillStroke ||
      operation === OPS.eoFillStroke ||
      operation === OPS.closeFillStroke ||
      operation === OPS.closeEOFillStroke
    ) {
      vectorLines.push(...state.pathLines.filter((line) => Math.abs(line.y2 - line.y1) <= line.width));
      state.pathLines = [];
      state.currentPoint = null;
      return;
    }
    if (operation === OPS.paintImageXObject) {
      const objectId = typeof args[0] === 'string' ? args[0] : null;
      if (objectId === null) return;

      const image = readImage(
        pageIndex,
        images.length,
        state,
        imageObject(page, objectId),
        numberAt(args, 1),
        numberAt(args, 2)
      );
      images.push(image);
      if (image.pixels === null) {
        warnings.push({
          code: 'IMAGE_DATA_UNAVAILABLE',
          message: `Page ${pageIndex + 1} image ${objectId} has no extractable pixel buffer`,
          pageIndex
        });
      }
      return;
    }
    if (operation === OPS.paintInlineImageXObject) {
      const image = readImage(pageIndex, images.length, state, args[0], null, null);
      images.push(image);
      if (image.pixels === null) {
        warnings.push({
          code: 'IMAGE_DATA_UNAVAILABLE',
          message: `Page ${pageIndex + 1} inline image has no extractable pixel buffer`,
          pageIndex
        });
      }
      return;
    }
    if (
      operation === OPS.paintImageXObjectRepeat ||
      operation === OPS.paintInlineImageXObjectGroup ||
      operation === OPS.paintImageMaskXObject ||
      operation === OPS.paintImageMaskXObjectGroup ||
      operation === OPS.paintImageMaskXObjectRepeat
    ) {
      warnings.push({
        code: 'IMAGE_OPERATOR_UNSUPPORTED',
        message: `Page ${pageIndex + 1} contains an image operator that cannot be represented as one positioned asset`,
        pageIndex
      });
    }
  });

  return { paintedCharacters: painted, vectorLines, images, warnings };
}
