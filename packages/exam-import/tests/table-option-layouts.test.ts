import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { DOCX_PART } from '../src/docx/docx-package';
import { readDocxRuns } from '../src/docx/read-docx-runs';
import { segmentExamImportRuns } from '../src/draft/exam-import-segmentation';

/**
 * Where a paper puts its options relative to its stems.
 *
 * Measured against the real papers this deployment imports: when the table also carries
 * the stem the segmenter reads it correctly. When the stem sits in a paragraph above and
 * the table holds only the options — the standard layout of a Vietnamese maths or physics
 * paper — every question used to come out unresolved.
 */
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

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

async function shapesOf(body: string) {
  const draft = segmentExamImportRuns((await readDocxRuns(await docx(body))).runs, {
    assetId: 'asset',
    fileName: 'exam.docx',
    mimeType: MIME,
    extractor: 'docx'
  });
  const questions = draft.sections.flatMap((section) => section.questions);

  return questions.map((question) => ({
    number: question.sourceNumber,
    kind: (question as { kind: string }).kind,
    options: ((question as { options?: unknown[] }).options ?? []).length
  }));
}

const FIRST = ['A. 4', 'B. 5', 'C. 6', 'D. 7'];
const SECOND = ['A. 2x', 'B. x', 'C. x²', 'D. 2'];
const EXPECTED = [
  { number: '1', kind: 'choice', options: 4 },
  { number: '2', kind: 'choice', options: 4 }
];

describe('table option layouts', () => {
  it('reads a table whose first cell carries the stem', async () => {
    const body =
      table(row(`Câu 1: ${FIRST[0]}`, FIRST[1], FIRST[2], FIRST[3])) +
      table(row(`Câu 2: ${SECOND[0]}`, SECOND[1], SECOND[2], SECOND[3]));
    await expect(shapesOf(body)).resolves.toEqual(EXPECTED);
  });

  it('reads a table whose stem has its own row', async () => {
    const body = table(
      row('Câu 1: Giá trị của 2 + 3 bằng'),
      row(...FIRST),
      row('Câu 2: Đạo hàm của y = x² là'),
      row(...SECOND)
    );
    await expect(shapesOf(body)).resolves.toEqual(EXPECTED);
  });

  it('reads options in a 2x2 grid under a paragraph stem', async () => {
    const body =
      paragraph('Câu 1: Giá trị của 2 + 3 bằng') +
      table(row(FIRST[0], FIRST[1]), row(FIRST[2], FIRST[3])) +
      paragraph('Câu 2: Đạo hàm của y = x² là') +
      table(row(SECOND[0], SECOND[1]), row(SECOND[2], SECOND[3]));
    await expect(shapesOf(body)).resolves.toEqual(EXPECTED);
  });

  it('reads options in a single row under a paragraph stem', async () => {
    const body =
      paragraph('Câu 1: Giá trị của 2 + 3 bằng') +
      table(row(...FIRST)) +
      paragraph('Câu 2: Đạo hàm của y = x² là') +
      table(row(...SECOND));
    await expect(shapesOf(body)).resolves.toEqual(EXPECTED);
  });

  it('does not treat a content table as options', async () => {
    // A table of prose under a stem is passage content, not an option set.
    const body =
      paragraph('Câu 1: Dựa vào bảng sau, hãy cho biết kết quả nào đúng?') +
      table(row('Năm', 'Sản lượng'), row('2020', '15 triệu tấn'), row('2021', '17 triệu tấn')) +
      paragraph('A. Tăng') +
      paragraph('B. Giảm') +
      paragraph('C. Không đổi') +
      paragraph('D. Không xác định');
    await expect(shapesOf(body)).resolves.toEqual([{ number: '1', kind: 'choice', options: 4 }]);
  });
});
