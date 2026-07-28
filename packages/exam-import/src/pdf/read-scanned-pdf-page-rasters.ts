import { getDocument, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractPdfOperators, type PdfEmbeddedImage } from './pdf-operators';

export const SCANNED_PDF_RASTER_LIMITS = {
  pages: 20,
  pixelsPerPage: 20_000_000,
  totalPixels: 100_000_000
} as const;

export type ScannedPdfRasterErrorCode =
  | 'INVALID_PDF'
  | 'PAGE_LIMIT_EXCEEDED'
  | 'TEXT_LAYER_PRESENT'
  | 'PAGE_RASTER_MISSING'
  | 'PAGE_RASTER_AMBIGUOUS'
  | 'PAGE_RASTER_UNSUPPORTED'
  | 'PIXEL_LIMIT_EXCEEDED';

export class ScannedPdfRasterError extends Error {
  constructor(
    message: string,
    readonly code: ScannedPdfRasterErrorCode,
    readonly pageIndex: number | null,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'ScannedPdfRasterError';
  }
}

export type ScannedPdfRasterLimits = {
  pages: number;
  pixelsPerPage: number;
  totalPixels: number;
};

export type ScannedPdfPageRasterResult = {
  pages: PdfEmbeddedImage[];
  pageCount: number;
  totalPixels: number;
};

export type ScannedPdfPageRasterSummary = Omit<ScannedPdfPageRasterResult, 'pages'>;

type PdfTextContent = {
  items: Array<{ str?: unknown }>;
};

const PAGE_COVERAGE_TOLERANCE = 0.01;

function assertPositiveSafeInteger(value: number, name: keyof ScannedPdfRasterLimits): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`Scanned PDF ${name} limit must be a positive safe integer`);
  }
}

function validateLimits(limits: ScannedPdfRasterLimits): void {
  assertPositiveSafeInteger(limits.pages, 'pages');
  assertPositiveSafeInteger(limits.pixelsPerPage, 'pixelsPerPage');
  assertPositiveSafeInteger(limits.totalPixels, 'totalPixels');
}

function hasUsableText(content: PdfTextContent): boolean {
  return content.items.some((item) => typeof item.str === 'string' && item.str.trim().length > 0);
}

function pageDimensions(page: PDFPageProxy): { width: number; height: number } {
  const viewport = page.getViewport({ scale: 1, dontFlip: true });
  if (
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    throw new ScannedPdfRasterError('PDF page dimensions are invalid', 'PAGE_RASTER_UNSUPPORTED', null);
  }

  return { width: viewport.width, height: viewport.height };
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(1, Math.abs(right) * PAGE_COVERAGE_TOLERANCE);
}

function isFullPageRaster(image: PdfEmbeddedImage, pageWidth: number, pageHeight: number): boolean {
  return (
    approximatelyEqual(image.bounds.x, 0) &&
    approximatelyEqual(image.bounds.y, 0) &&
    approximatelyEqual(image.bounds.width, pageWidth) &&
    approximatelyEqual(image.bounds.height, pageHeight)
  );
}

function hasValidPixelBuffer(image: PdfEmbeddedImage): boolean {
  if (image.pixels === null || image.pixelFormat === null) return false;

  const pixelCount = image.intrinsicWidth * image.intrinsicHeight;
  if (!Number.isSafeInteger(pixelCount) || pixelCount <= 0) return false;
  if (image.pixelFormat === 'rgba-32bpp') return image.pixels.byteLength === pixelCount * 4;
  if (image.pixelFormat === 'rgb-24bpp') return image.pixels.byteLength === pixelCount * 3;

  const packedRowBytes = Math.ceil(image.intrinsicWidth / 8);
  return image.pixels.byteLength === pixelCount || image.pixels.byteLength === packedRowBytes * image.intrinsicHeight;
}

export function selectScannedPdfPageRaster(
  images: PdfEmbeddedImage[],
  pageIndex: number,
  pageWidth: number,
  pageHeight: number
): PdfEmbeddedImage {
  const candidates = images.filter((image) => isFullPageRaster(image, pageWidth, pageHeight));
  if (candidates.length === 0) {
    throw new ScannedPdfRasterError(
      `PDF page ${pageIndex + 1} has no full-page raster`,
      'PAGE_RASTER_MISSING',
      pageIndex
    );
  }
  if (candidates.length > 1) {
    throw new ScannedPdfRasterError(
      `PDF page ${pageIndex + 1} has multiple full-page rasters`,
      'PAGE_RASTER_AMBIGUOUS',
      pageIndex
    );
  }

  const candidate = candidates[0]!;
  if (!hasValidPixelBuffer(candidate)) {
    throw new ScannedPdfRasterError(
      `PDF page ${pageIndex + 1} raster pixels are unavailable or unsupported`,
      'PAGE_RASTER_UNSUPPORTED',
      pageIndex
    );
  }

  return {
    ...candidate,
    assetRef: `pdf-page-raster-${pageIndex}`,
    pageIndex,
    bounds: { x: 0, y: 0, width: pageWidth, height: pageHeight }
  };
}

export async function readScannedPdfPageRasters(
  data: Uint8Array,
  limits: ScannedPdfRasterLimits = SCANNED_PDF_RASTER_LIMITS
): Promise<ScannedPdfPageRasterResult> {
  validateLimits(limits);
  const loadingTask = getDocument({
    data: Uint8Array.from(data),
    maxImageSize: limits.pixelsPerPage,
    disableAutoFetch: true,
    disableRange: true,
    disableStream: true,
    disableFontFace: true,
    stopAtErrors: true,
    useSystemFonts: false,
    useWasm: false,
    useWorkerFetch: false,
    verbosity: 0
  });
  const loadedPages: PDFPageProxy[] = [];

  try {
    const documentProxy = await loadingTask.promise;
    if (documentProxy.numPages > limits.pages) {
      throw new ScannedPdfRasterError(`PDF exceeds the ${limits.pages}-page raster limit`, 'PAGE_LIMIT_EXCEEDED', null);
    }

    const pages: PdfEmbeddedImage[] = [];
    let totalPixels = 0;

    for (let pageNumber = 1; pageNumber <= documentProxy.numPages; pageNumber += 1) {
      const pageIndex = pageNumber - 1;
      const page = await documentProxy.getPage(pageNumber);
      loadedPages.push(page);
      const content = (await page.getTextContent()) as PdfTextContent;
      if (hasUsableText(content)) {
        throw new ScannedPdfRasterError(
          `PDF page ${pageNumber} contains a usable text layer`,
          'TEXT_LAYER_PRESENT',
          pageIndex
        );
      }

      const dimensions = pageDimensions(page);
      const operatorList = await page.getOperatorList();
      const extraction = extractPdfOperators(page, pageIndex, operatorList);
      const raster = selectScannedPdfPageRaster(extraction.images, pageIndex, dimensions.width, dimensions.height);
      const pagePixels = raster.intrinsicWidth * raster.intrinsicHeight;
      if (!Number.isSafeInteger(pagePixels) || pagePixels <= 0 || pagePixels > limits.pixelsPerPage) {
        throw new ScannedPdfRasterError(
          `PDF page ${pageNumber} raster exceeds the per-page pixel limit`,
          'PIXEL_LIMIT_EXCEEDED',
          pageIndex
        );
      }
      totalPixels += pagePixels;
      if (!Number.isSafeInteger(totalPixels) || totalPixels > limits.totalPixels) {
        throw new ScannedPdfRasterError(
          'PDF page rasters exceed the total pixel limit',
          'PIXEL_LIMIT_EXCEEDED',
          pageIndex
        );
      }

      pages.push(raster);
    }

    return { pages, pageCount: documentProxy.numPages, totalPixels };
  } catch (error) {
    if (error instanceof ScannedPdfRasterError) throw error;

    throw new ScannedPdfRasterError('PDF page rasters could not be extracted', 'INVALID_PDF', null, {
      cause: error instanceof Error ? error : new Error('Unknown PDF raster extraction failure')
    });
  } finally {
    for (const page of loadedPages) {
      try {
        page.cleanup();
      } catch (error) {
        console.error('readScannedPdfPageRasters page cleanup error:', error);
      }
    }

    try {
      await loadingTask.destroy();
    } catch (error) {
      console.error('readScannedPdfPageRasters loading task destroy error:', error);
    }
  }
}

export async function visitScannedPdfPageRasters(
  data: Uint8Array,
  visitPage: (page: PdfEmbeddedImage) => Promise<void>,
  limits: ScannedPdfRasterLimits = SCANNED_PDF_RASTER_LIMITS
): Promise<ScannedPdfPageRasterSummary> {
  validateLimits(limits);
  const loadingTask = getDocument({
    data: Uint8Array.from(data),
    maxImageSize: limits.pixelsPerPage,
    disableAutoFetch: true,
    disableRange: true,
    disableStream: true,
    disableFontFace: true,
    stopAtErrors: true,
    useSystemFonts: false,
    useWasm: false,
    useWorkerFetch: false,
    verbosity: 0
  });
  let visitorFailed = false;

  try {
    const documentProxy = await loadingTask.promise;
    if (documentProxy.numPages > limits.pages) {
      throw new ScannedPdfRasterError(`PDF exceeds the ${limits.pages}-page raster limit`, 'PAGE_LIMIT_EXCEEDED', null);
    }

    let totalPixels = 0;
    for (let pageNumber = 1; pageNumber <= documentProxy.numPages; pageNumber += 1) {
      const pageIndex = pageNumber - 1;
      const page = await documentProxy.getPage(pageNumber);

      try {
        const content = (await page.getTextContent()) as PdfTextContent;
        if (hasUsableText(content)) {
          throw new ScannedPdfRasterError(
            `PDF page ${pageNumber} contains a usable text layer`,
            'TEXT_LAYER_PRESENT',
            pageIndex
          );
        }

        const dimensions = pageDimensions(page);
        const operatorList = await page.getOperatorList();
        const extraction = extractPdfOperators(page, pageIndex, operatorList);
        const raster = selectScannedPdfPageRaster(extraction.images, pageIndex, dimensions.width, dimensions.height);
        const pagePixels = raster.intrinsicWidth * raster.intrinsicHeight;
        if (!Number.isSafeInteger(pagePixels) || pagePixels <= 0 || pagePixels > limits.pixelsPerPage) {
          throw new ScannedPdfRasterError(
            `PDF page ${pageNumber} raster exceeds the per-page pixel limit`,
            'PIXEL_LIMIT_EXCEEDED',
            pageIndex
          );
        }
        totalPixels += pagePixels;
        if (!Number.isSafeInteger(totalPixels) || totalPixels > limits.totalPixels) {
          throw new ScannedPdfRasterError(
            'PDF page rasters exceed the total pixel limit',
            'PIXEL_LIMIT_EXCEEDED',
            pageIndex
          );
        }

        try {
          await visitPage(raster);
        } catch (error) {
          visitorFailed = true;
          throw error;
        }
      } finally {
        try {
          page.cleanup();
        } catch (error) {
          console.error('visitScannedPdfPageRasters page cleanup error:', error);
        }
      }
    }

    return { pageCount: documentProxy.numPages, totalPixels };
  } catch (error) {
    if (visitorFailed || error instanceof ScannedPdfRasterError) throw error;

    throw new ScannedPdfRasterError('PDF page rasters could not be extracted', 'INVALID_PDF', null, {
      cause: error instanceof Error ? error : new Error('Unknown PDF raster extraction failure')
    });
  } finally {
    try {
      await loadingTask.destroy();
    } catch (error) {
      console.error('visitScannedPdfPageRasters loading task destroy error:', error);
    }
  }
}
