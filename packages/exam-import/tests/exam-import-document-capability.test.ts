import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { inspectExamImportDocument } from '../src/document/exam-import-document-capability';

async function createDocxBytes(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>'
  );
  zip.file(
    'word/document.xml',
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body /></w:document>'
  );

  return zip.generateAsync({ type: 'uint8array' });
}

describe('inspectExamImportDocument', () => {
  it('accepts a valid DOCX from its bytes without relying on file metadata', async () => {
    const bytes = await createDocxBytes();

    await expect(inspectExamImportDocument(bytes, bytes.byteLength)).resolves.toEqual({
      detectedType: 'docx',
      supported: true,
      reason: null
    });
  });

  it('recognizes PDF bytes without relying on file metadata', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\n');

    await expect(inspectExamImportDocument(bytes, bytes.byteLength)).resolves.toEqual({
      detectedType: 'pdf',
      supported: true,
      reason: null
    });
  });

  it('recognizes an Aiken exam from its UTF-8 content', async () => {
    const bytes = new TextEncoder().encode(
      ['Which number is prime?', 'A. 4', 'B. 5', 'C. 6', 'D. 8', 'ANSWER: B'].join('\n')
    );

    await expect(inspectExamImportDocument(bytes, bytes.byteLength, 'exam.aiken')).resolves.toEqual({
      detectedType: 'aiken',
      supported: true,
      reason: null
    });
  });

  it('recognizes a GIFT exam from its UTF-8 content', async () => {
    const bytes = new TextEncoder().encode('::Prime::Which number is prime? {~4 =5 ~6 ~8}');

    await expect(inspectExamImportDocument(bytes, bytes.byteLength, 'exam.gift')).resolves.toEqual({
      detectedType: 'gift',
      supported: true,
      reason: null
    });
  });

  it('does not trust an interchange extension without the matching grammar', async () => {
    const bytes = new TextEncoder().encode('This is ordinary text.');

    await expect(inspectExamImportDocument(bytes, bytes.byteLength, 'exam.gift')).resolves.toEqual({
      detectedType: null,
      supported: false,
      reason: 'unsupported_file'
    });
  });

  it('rejects ambiguous text matching both interchange grammars', async () => {
    const bytes = new TextEncoder().encode(
      ['Question {=yes ~no}', 'A. One', 'B. Two', 'C. Three', 'D. Four', 'ANSWER: A'].join('\n')
    );

    await expect(inspectExamImportDocument(bytes, bytes.byteLength)).resolves.toEqual({
      detectedType: null,
      supported: false,
      reason: 'unsupported_file'
    });
  });

  it('rejects invalid UTF-8 text', async () => {
    const bytes = new Uint8Array([0xc3, 0x28]);

    await expect(inspectExamImportDocument(bytes, bytes.byteLength, 'exam.aiken')).resolves.toEqual({
      detectedType: null,
      supported: false,
      reason: 'unsupported_file'
    });
  });

  it('rejects an extension-spoofed non-document', async () => {
    const bytes = new TextEncoder().encode('this is not a document');

    await expect(inspectExamImportDocument(bytes, bytes.byteLength)).resolves.toEqual({
      detectedType: null,
      supported: false,
      reason: 'unsupported_file'
    });
  });

  it('rejects the actual bytes when they exceed the configured limit', async () => {
    const bytes = new Uint8Array(11);

    await expect(inspectExamImportDocument(bytes, 10)).resolves.toEqual({
      detectedType: null,
      supported: false,
      reason: 'file_too_large'
    });
  });

  it('rejects a ZIP without the required DOCX document part', async () => {
    const zip = new JSZip();
    zip.file('notes.txt', 'not a DOCX');
    const bytes = await zip.generateAsync({ type: 'uint8array' });

    await expect(inspectExamImportDocument(bytes, bytes.byteLength)).resolves.toEqual({
      detectedType: null,
      supported: false,
      reason: 'unsupported_file'
    });
  });
});
