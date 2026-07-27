import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PdfReadError, readPdfRuns } from '../src/pdf/read-pdf-runs';
import { sourceRunSchema } from '../src/source-run';

const SCANNED_PDF = join(__dirname, '..', '..', '..', 'Template', 'S6nBtwX0locnFWABbn6vp-e-on-luyen-so-03.pdf');

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

function textPdf(): Uint8Array {
  const content = [
    'BT /F1 12 Tf 1 0 0 rg 72 720 Td (Question 1.) Tj ET',
    'BT /F1 12 Tf 0 0 1 rg 72 700 Td (A. Alpha) Tj ET',
    '0.5 w 72 697 m 118 697 l S',
    'q 20 0 0 10 72 650 cm /Im1 Do Q'
  ].join('\n');
  const imageBytes = 'RGB';

  return createPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /Font << /F1 4 0 R >> /XObject << /Im1 6 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /ABCDEF+Helvetica-Bold >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB ` +
      `/BitsPerComponent 8 /Length ${imageBytes.length} >>\nstream\n${imageBytes}\nendstream`
  ]);
}

describe('text PDF reader', () => {
  it('emits deterministic SourceRuns with font, color, weak underline and positioned image data', async () => {
    const bytes = textPdf();
    const first = await readPdfRuns(bytes);
    const second = await readPdfRuns(bytes);

    expect(second).toEqual(first);
    expect(first.pageCount).toBe(1);
    expect(first.runs.every((run) => sourceRunSchema.safeParse(run).success)).toBe(true);
    expect(first.runs.every((run) => run.block.listNumber === null)).toBe(true);
    expect(first.runs.every((run) => run.formatting.underline === false)).toBe(true);

    const question = first.runs.find((run) => run.text.includes('Question 1.'));
    const option = first.runs.find((run) => run.text.includes('A. Alpha'));
    expect(question?.formatting).toMatchObject({ bold: true, color: '#FF0000' });
    expect(option?.formatting).toMatchObject({ bold: true, color: '#0000FF' });

    expect(first.weakEmphasis).toHaveLength(1);
    expect(first.weakEmphasis[0]).toMatchObject({
      kind: 'underline',
      strength: 'weak',
      source: 'drawn_line'
    });

    expect(first.assets).toHaveLength(1);
    expect(first.assets[0]).toMatchObject({
      pageIndex: 0,
      intrinsicWidth: 1,
      intrinsicHeight: 1,
      pixelFormat: 'rgb-24bpp',
      bounds: { x: 72, y: 650, width: 20, height: 10 }
    });
    expect(first.assets[0]!.pixels).toEqual(new Uint8Array([82, 71, 66]));
    expect(first.runs.some((run) => run.image?.assetRef === first.assets[0]!.assetRef)).toBe(true);
  });

  it('fails closed with a typed error for the supplied five-page scan', async () => {
    const bytes = new Uint8Array(readFileSync(SCANNED_PDF));

    await expect(readPdfRuns(bytes)).rejects.toMatchObject({
      name: 'PdfReadError',
      code: 'NO_TEXT_LAYER',
      pageCount: 5,
      extractedCharacterCount: 0
    } satisfies Partial<PdfReadError>);
  });

  it('wraps malformed input in a typed invalid-PDF error', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\nnot a PDF');

    await expect(readPdfRuns(bytes)).rejects.toMatchObject({
      name: 'PdfReadError',
      code: 'INVALID_PDF'
    } satisfies Partial<PdfReadError>);
  });
});
