import { DocxPackageError, openDocxPackage } from '../docx/docx-package';

export type ExamImportDocumentType = 'docx' | 'pdf' | 'aiken' | 'gift';
export type ExamImportDocumentCapabilityReason =
  | 'extractor_unavailable'
  | 'file_too_large'
  | 'invalid_document'
  | 'unsupported_file';

export type ExamImportDocumentInspection = {
  detectedType: ExamImportDocumentType | null;
  supported: boolean;
  reason: ExamImportDocumentCapabilityReason | null;
};

const PDF_HEADER = new TextEncoder().encode('%PDF-');
const MAX_PDF_HEADER_OFFSET = 1_024;
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });

function hasPdfHeader(bytes: Uint8Array): boolean {
  const lastOffset = Math.min(bytes.byteLength - PDF_HEADER.byteLength, MAX_PDF_HEADER_OFFSET);
  for (let offset = 0; offset <= lastOffset; offset += 1) {
    if (PDF_HEADER.every((value, index) => bytes[offset + index] === value)) return true;
  }

  return false;
}

function hasZipHeader(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function detectTextExamType(bytes: Uint8Array, fileName: string | null): ExamImportDocumentType | null {
  let text: string;
  try {
    text = TEXT_DECODER.decode(bytes);
  } catch {
    return null;
  }
  if (text.length === 0 || text.includes('\0')) return null;

  const normalizedName = fileName?.trim().toLowerCase() ?? '';
  const aikenShape =
    /(?:^|\n)A\.\s+\S/u.test(text) &&
    /(?:^|\n)B\.\s+\S/u.test(text) &&
    /(?:^|\n)ANSWER:\s*[A-D]\s*(?:\n|$)/u.test(text);
  const giftShape = /\{[\s\S]*?(?:^|[^\\])[=~]\s*\S[\s\S]*?\}/u.test(text);

  if (normalizedName.endsWith('.aiken') && aikenShape) return 'aiken';
  if (normalizedName.endsWith('.gift') && giftShape) return 'gift';
  if (aikenShape && !giftShape) return 'aiken';
  if (giftShape && !aikenShape) return 'gift';

  return null;
}

export async function inspectExamImportDocument(
  bytes: Uint8Array,
  maxBytes: number,
  fileName: string | null = null
): Promise<ExamImportDocumentInspection> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError('Exam import document limit must be a positive safe integer');
  }

  if (bytes.byteLength > maxBytes) {
    return { detectedType: null, supported: false, reason: 'file_too_large' };
  }

  if (hasPdfHeader(bytes)) {
    return { detectedType: 'pdf', supported: true, reason: null };
  }

  if (!hasZipHeader(bytes)) {
    const textType = detectTextExamType(bytes, fileName);
    if (textType !== null) {
      return { detectedType: textType, supported: true, reason: null };
    }

    return { detectedType: null, supported: false, reason: 'unsupported_file' };
  }

  try {
    await openDocxPackage(bytes, {
      maxCompressedBytes: maxBytes,
      maxEntries: 2_000,
      maxTotalUncompressedBytes: Math.max(maxBytes, Math.min(maxBytes * 3, Number.MAX_SAFE_INTEGER)),
      maxPartBytes: maxBytes
    });

    return { detectedType: 'docx', supported: true, reason: null };
  } catch (error) {
    if (!(error instanceof DocxPackageError)) throw error;

    const reason =
      error.code === 'NOT_A_ZIP' || error.code === 'MISSING_DOCUMENT' ? 'unsupported_file' : 'invalid_document';
    return { detectedType: null, supported: false, reason };
  }
}
