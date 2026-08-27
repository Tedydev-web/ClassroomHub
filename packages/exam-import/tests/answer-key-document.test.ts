import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { DOCX_PART } from '../src/docx/docx-package';
import { readDocxRuns } from '../src/docx/read-docx-runs';
import { readAnswerKeyPairsFromRuns, toCompactAnswerKey } from '../src/draft/exam-import-answer-key-document';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const paragraph = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const cell = (text: string) => `<w:tc>${paragraph(text)}</w:tc>`;
const row = (...cells: string[]) => `<w:tr>${cells.map(cell).join('')}</w:tr>`;
const table = (...rows: string[]) => `<w:tbl>${rows.join('')}</w:tbl>`;

async function docx(body: string) {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>'
  );
  zip.file(
    '_rels/.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>'
  );
  zip.file(DOCX_PART.document, `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`);
  return zip.generateAsync({ type: 'uint8array' });
}

async function keyOf(body: string) {
  return toCompactAnswerKey(readAnswerKeyPairsFromRuns((await readDocxRuns(await docx(body))).runs));
}

describe('answer key document', () => {
  it('reads a key file written as a grid with no header', async () => {
    const body = paragraph('ĐÁP ÁN ĐỀ SỐ 1') + table(row('1', '2', '3', '4'), row('B', 'C', 'A', 'D'));
    await expect(keyOf(body)).resolves.toBe('1B 2C 3A 4D');
  });

  it('reads a key file written as a headed table', async () => {
    const body = table(row('Câu', 'Đáp án'), row('1', 'B'), row('2', 'C'), row('3', 'A'), row('4', 'D'));
    await expect(keyOf(body)).resolves.toBe('1B 2C 3A 4D');
  });

  it('reads a key file written one answer per line', async () => {
    const body = paragraph('ĐÁP ÁN') + ['B', 'C', 'A', 'D'].map((v, i) => paragraph(`${i + 1}. ${v}`)).join('');
    await expect(keyOf(body)).resolves.toBe('1B 2C 3A 4D');
  });

  it('reads a key file written as one compact line', async () => {
    await expect(keyOf(paragraph('ĐÁP ÁN: 1B 2C 3A 4D'))).resolves.toBe('1B 2C 3A 4D');
  });

  it('sorts by question number so a key written out of order still lines up', async () => {
    await expect(keyOf(paragraph('3A 1B 4D 2C'))).resolves.toBe('1B 2C 3A 4D');
  });

  it('finds no key in a document that states none', async () => {
    await expect(keyOf(paragraph('Đây là một tài liệu bình thường, không có đáp án.'))).resolves.toBe('');
  });
});

/**
 * The most common key file of all: the paper itself, with the answers marked.
 *
 * Every keyed document in this corpus states its key that way, and the reader missed it —
 * it only knew the compact carriers. Caught by running the endpoint against a real file
 * rather than against the shapes the unit tests happened to imagine.
 */
describe('answer key document — a marked-up copy of the paper', () => {
  it('reads a key from a paper whose answers are highlighted', async () => {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const bytes = new Uint8Array(
      await readFile(join(__dirname, '..', '..', '..', 'fixtures', 'exams', '2026-g12-key-to-test-2.docx'))
    );

    const key = toCompactAnswerKey(readAnswerKeyPairsFromRuns((await readDocxRuns(bytes)).runs));

    // Read by hand from the highlight runs when the document entered the corpus.
    expect(key).toBe(
      '1B 2D 3C 4C 5C 6C 7D 8A 9D 10B 11D 12C 13D 14C 15D 16D 17B 18B 19B 20C 21C 22B 23A 24C 25D 26D 27A 28D 29C 30A'
    );
  }, 60000);
});
