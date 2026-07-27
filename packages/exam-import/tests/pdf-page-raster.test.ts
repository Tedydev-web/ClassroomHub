import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import {
  ScannedPdfRasterError,
  readScannedPdfPageRasters,
  selectScannedPdfPageRaster,
  visitScannedPdfPageRasters
} from '../src/pdf/read-scanned-pdf-page-rasters';
import type { PdfEmbeddedImage } from '../src/pdf/pdf-operators';
import { readPdfRuns } from '../src/pdf/read-pdf-runs';

const SCANNED_PDF = join(__dirname, '..', '..', '..', 'fixtures', 'exams', 'large', '2026-en-on-luyen-03-scan.pdf');

function createPdf(objects: string[]): Uint8Array {
  let source = '%PDF-1.7\n';
  const offsets: number[] = [];

  objects.forEach((object, index) => {
    offsets.push(source.length);
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const crossReferenceOffset = source.length;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) source += `${String(offset).padStart(10, '0')} 00000 n \n`;
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  source += `startxref\n${crossReferenceOffset}\n%%EOF\n`;

  return new TextEncoder().encode(source);
}

type PageInput = {
  images: Array<{ width: number; height: number; colorSpace?: string; bitsPerComponent?: number }>;
  text?: string;
};

function imagePdf(pageInputs: PageInput[]): Uint8Array {
  const objects: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', ''];
  const pageObjectIds: number[] = [];

  for (const pageInput of pageInputs) {
    const pageObjectId = objects.length + 1;
    const contentObjectId = pageObjectId + 1;
    const fontObjectId = pageInput.text ? contentObjectId + 1 : null;
    const firstImageObjectId = contentObjectId + (fontObjectId === null ? 1 : 2);
    const imageNames = pageInput.images
      .map((_, index) => `/Im${index + 1} ${firstImageObjectId + index} 0 R`)
      .join(' ');
    const fontResource = fontObjectId === null ? '' : `/Font << /F1 ${fontObjectId} 0 R >>`;
    const content = [
      ...pageInput.images.map((_, index) => `q 100 0 0 200 0 0 cm /Im${index + 1} Do Q`),
      ...(pageInput.text ? [`BT /F1 12 Tf 10 10 Td (${pageInput.text}) Tj ET`] : [])
    ].join('\n');

    pageObjectIds.push(pageObjectId);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 200] /Resources << ${fontResource} ` +
        `/XObject << ${imageNames} >> >> /Contents ${contentObjectId} 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
    );
    if (fontObjectId !== null) objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

    for (const image of pageInput.images) {
      const channels = image.colorSpace === '/DeviceGray' ? 1 : 3;
      const bytes = String.fromCharCode(...Array.from({ length: image.width * image.height * channels }, () => 127));
      objects.push(
        `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
          `/ColorSpace ${image.colorSpace ?? '/DeviceRGB'} /BitsPerComponent ${image.bitsPerComponent ?? 8} ` +
          `/Length ${bytes.length} >>\nstream\n${bytes}\nendstream`
      );
    }
  }

  objects[1] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${
    pageObjectIds.length
  } >>`;

  return createPdf(objects);
}

describe('scanned PDF page raster extraction', () => {
  it('extracts exactly one normalized full-page raster per text-free page', async () => {
    const bytes = imagePdf([{ images: [{ width: 2, height: 3 }] }, { images: [{ width: 3, height: 2 }] }]);

    const result = await readScannedPdfPageRasters(bytes);

    expect(result).toMatchObject({ pageCount: 2, totalPixels: 12 });
    expect(result.pages).toHaveLength(2);
    expect(result.pages.map((page) => page.assetRef)).toEqual(['pdf-page-raster-0', 'pdf-page-raster-1']);
    expect(result.pages.every((page) => page.bounds.x === 0 && page.bounds.y === 0)).toBe(true);
    expect(result.pages.every((page) => page.bounds.width === 100 && page.bounds.height === 200)).toBe(true);
    expect(result.pages.every((page) => page.pixelFormat === 'rgb-24bpp' && page.pixels !== null)).toBe(true);
  });

  it('visits one normalized page at a time in document order', async () => {
    const bytes = imagePdf([{ images: [{ width: 2, height: 3 }] }, { images: [{ width: 3, height: 2 }] }]);
    const visited: Array<{ pageIndex: number; pixels: number }> = [];
    let activeVisitors = 0;
    let peakVisitors = 0;

    const result = await visitScannedPdfPageRasters(bytes, async (page) => {
      activeVisitors += 1;
      peakVisitors = Math.max(peakVisitors, activeVisitors);
      visited.push({
        pageIndex: page.pageIndex,
        pixels: page.intrinsicWidth * page.intrinsicHeight
      });
      await Promise.resolve();
      activeVisitors -= 1;
    });

    expect(result).toEqual({ pageCount: 2, totalPixels: 12 });
    expect(visited).toEqual([
      { pageIndex: 0, pixels: 6 },
      { pageIndex: 1, pixels: 6 }
    ]);
    expect(peakVisitors).toBe(1);
  });

  it('streams all five full-resolution pages from the reference scan', async () => {
    const bytes = new Uint8Array(readFileSync(SCANNED_PDF));
    const pages: Array<{ pageIndex: number; width: number; height: number }> = [];

    const result = await visitScannedPdfPageRasters(bytes, async (page) => {
      pages.push({
        pageIndex: page.pageIndex,
        width: page.intrinsicWidth,
        height: page.intrinsicHeight
      });
    });

    expect(result).toEqual({ pageCount: 5, totalPixels: 43_499_200 });
    expect(pages).toEqual(
      Array.from({ length: 5 }, (_, pageIndex) => ({
        pageIndex,
        width: 2480,
        height: 3508
      }))
    );
  });

  it('fails closed when a page raster is missing or ambiguous', async () => {
    await expect(readScannedPdfPageRasters(imagePdf([{ images: [] }]))).rejects.toMatchObject({
      code: 'PAGE_RASTER_MISSING',
      pageIndex: 0
    } satisfies Partial<ScannedPdfRasterError>);
    await expect(
      readScannedPdfPageRasters(
        imagePdf([
          {
            images: [
              { width: 1, height: 1 },
              { width: 1, height: 1 }
            ]
          }
        ])
      )
    ).rejects.toMatchObject({
      code: 'PAGE_RASTER_AMBIGUOUS',
      pageIndex: 0
    } satisfies Partial<ScannedPdfRasterError>);
  });

  it('fails closed for unsupported pixels, text layers, and page or pixel limits', async () => {
    const unsupportedRaster: PdfEmbeddedImage = {
      assetRef: 'unsupported',
      pageIndex: 0,
      bounds: { x: 0, y: 0, width: 100, height: 200 },
      intrinsicWidth: 1,
      intrinsicHeight: 1,
      pixels: new Uint8Array([0]),
      pixelFormat: null
    };
    expect(() => selectScannedPdfPageRaster([unsupportedRaster], 0, 100, 200)).toThrowError(
      expect.objectContaining({
        code: 'PAGE_RASTER_UNSUPPORTED',
        pageIndex: 0
      })
    );
    expect(() =>
      selectScannedPdfPageRaster([{ ...unsupportedRaster, pixelFormat: 'rgb-24bpp' }], 0, 100, 200)
    ).toThrowError(
      expect.objectContaining({
        code: 'PAGE_RASTER_UNSUPPORTED',
        pageIndex: 0
      })
    );

    await expect(
      readScannedPdfPageRasters(imagePdf([{ images: [{ width: 1, height: 1 }], text: 'visible' }]))
    ).rejects.toMatchObject({
      code: 'TEXT_LAYER_PRESENT',
      pageIndex: 0
    } satisfies Partial<ScannedPdfRasterError>);

    const twoPages = imagePdf([{ images: [{ width: 2, height: 2 }] }, { images: [{ width: 2, height: 2 }] }]);
    await expect(
      readScannedPdfPageRasters(twoPages, { pages: 1, pixelsPerPage: 4, totalPixels: 8 })
    ).rejects.toMatchObject({ code: 'PAGE_LIMIT_EXCEEDED' } satisfies Partial<ScannedPdfRasterError>);
    await expect(
      readScannedPdfPageRasters(twoPages, { pages: 2, pixelsPerPage: 3, totalPixels: 8 })
    ).rejects.toMatchObject({
      code: 'PAGE_RASTER_MISSING',
      pageIndex: 0
    } satisfies Partial<ScannedPdfRasterError>);
    await expect(
      readScannedPdfPageRasters(twoPages, { pages: 2, pixelsPerPage: 4, totalPixels: 7 })
    ).rejects.toMatchObject({
      code: 'PIXEL_LIMIT_EXCEEDED',
      pageIndex: 1
    } satisfies Partial<ScannedPdfRasterError>);
  });

  it('does not change normal text-PDF behavior', async () => {
    const bytes = imagePdf([{ images: [{ width: 1, height: 1 }], text: 'Question 1' }]);

    const result = await readPdfRuns(bytes);

    expect(result.pageCount).toBe(1);
    expect(result.runs.some((run) => run.text.includes('Question 1'))).toBe(true);
  });
});
