import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { DOCX_PART } from '../src/docx/docx-package';
import { readDocxRuns } from '../src/docx/read-docx-runs';
import { createExamImportDraftFromRuns } from '../src/draft/exam-import-pipeline';

/**
 * The shapes a Vietnamese paper carries its answer key in.
 *
 * Four of these were already read correctly. The rest were measured against the real
 * importer and found missing — and one of them did worse than miss: a trailing `1. B`
 * list was parsed as a second set of questions, so a forty-question paper became eighty.
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

// A run carrying `<w:b/>`, so a paper can mark its answer by emboldening the option.
const boldRun = (text: string) => `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const plainRun = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const optionParagraph = (label: string, body: string, bold: boolean) =>
  `<w:p>${bold ? boldRun(label) : plainRun(label)}${plainRun(body)}</w:p>`;

const KEY = ['B', 'C', 'A', 'D'];
const QUESTIONS = KEY.map(
  (_, index) =>
    paragraph(`Câu ${index + 1}: Nội dung câu hỏi số ${index + 1}?`) +
    paragraph(`A. đáp án A${index + 1}`) +
    paragraph(`B. đáp án B${index + 1}`) +
    paragraph(`C. đáp án C${index + 1}`) +
    paragraph(`D. đáp án D${index + 1}`)
).join('');

async function importWith(tail: string) {
  const read = await readDocxRuns(await docx(QUESTIONS + tail));
  const draft = createExamImportDraftFromRuns(read.runs, {
    assetId: 'asset',
    fileName: 'exam.docx',
    mimeType: MIME,
    extractor: 'docx'
  } as never);
  const questions = draft.sections.flatMap((section) => section.questions);

  return {
    count: questions.length,
    answers: questions.map((question) => {
      const options = (question as { options?: Array<{ id: string; sourceLabel: string }> }).options ?? [];
      const key = (question as { answerKey?: { correctOptionIds?: string[] } | null }).answerKey;
      return (key?.correctOptionIds ?? [])
        .map((id) => options.find((option) => option.id === id)?.sourceLabel ?? '?')
        .join('');
    })
  };
}

describe('answer key carriers', () => {
  it('reads a paper that marks its answers in bold instead of highlight', async () => {
    // Bold is listed beside underline, highlight and colour as an answer carrier, but every
    // test for it until now checked only that bold is *ignored* when it covers every option.
    // A paper that emboldens exactly the correct option is the commoner case and had no test
    // at all, so this pins the direction that actually produces a key.
    const body = KEY.map(
      (answer, index) =>
        paragraph(`Câu ${index + 1}: Nội dung câu hỏi số ${index + 1}?`) +
        ['A', 'B', 'C', 'D']
          .map((label) => optionParagraph(`${label}.`, ` đáp án ${label}${index + 1}`, label === answer))
          .join('')
    ).join('');

    const read = await readDocxRuns(await docx(body));
    const draft = createExamImportDraftFromRuns(read.runs, {
      assetId: 'asset',
      fileName: 'exam.docx',
      mimeType: MIME,
      extractor: 'docx'
    } as never);
    const questions = draft.sections.flatMap((section) => section.questions);

    expect(questions).toHaveLength(4);
    expect(
      questions.map((question) => {
        const options = (question as { options?: Array<{ id: string; sourceLabel: string }> }).options ?? [];
        const key = (question as { answerKey?: { correctOptionIds?: string[] } | null }).answerKey;

        return (key?.correctOptionIds ?? [])
          .map((id) => options.find((option) => option.id === id)?.sourceLabel ?? '?')
          .join('');
      })
    ).toEqual(KEY);
  });

  it('reads a vertical table headed Câu / Đáp án', async () => {
    const tail =
      paragraph('ĐÁP ÁN') + table(row('Câu', 'Đáp án'), ...KEY.map((answer, index) => row(String(index + 1), answer)));
    await expect(importWith(tail)).resolves.toEqual({ count: 4, answers: KEY });
  });

  it('reads a horizontal table with a leading label column', async () => {
    const tail =
      paragraph('ĐÁP ÁN') + table(row('Câu', ...KEY.map((_, index) => String(index + 1))), row('Đáp án', ...KEY));
    await expect(importWith(tail)).resolves.toEqual({ count: 4, answers: KEY });
  });

  it('reads a compact key string', async () => {
    await expect(importWith(paragraph('ĐÁP ÁN: 1B 2C 3A 4D'))).resolves.toEqual({ count: 4, answers: KEY });
  });

  // The gaps.

  it('reads a horizontal grid whose header row is bare question numbers', async () => {
    const tail = paragraph('ĐÁP ÁN') + table(row(...KEY.map((_, index) => String(index + 1))), row(...KEY));
    await expect(importWith(tail)).resolves.toEqual({ count: 4, answers: KEY });
  });

  it('reads a grid written in blocks of numbers and answers', async () => {
    const tail = paragraph('ĐÁP ÁN') + table(row('1', '2'), row(KEY[0], KEY[1]), row('3', '4'), row(KEY[2], KEY[3]));
    await expect(importWith(tail)).resolves.toEqual({ count: 4, answers: KEY });
  });

  it('reads a trailing list of "1. B" lines without inventing questions', async () => {
    const tail = paragraph('ĐÁP ÁN') + KEY.map((answer, index) => paragraph(`${index + 1}. ${answer}`)).join('');
    await expect(importWith(tail)).resolves.toEqual({ count: 4, answers: KEY });
  });

  it('reads a trailing list of "Đáp án 1: B" lines', async () => {
    const tail = KEY.map((answer, index) => paragraph(`Đáp án ${index + 1}: ${answer}`)).join('');
    await expect(importWith(tail)).resolves.toEqual({ count: 4, answers: KEY });
  });

  it('leaves a paper with no key unanswered rather than inventing one', async () => {
    await expect(importWith('')).resolves.toEqual({ count: 4, answers: ['', '', '', ''] });
  });

  it('does not mistake a numbered question for an answer line', async () => {
    // `1. B` is a key line; `Câu 5: ...` with options is a question even though it is
    // numbered and followed by a letter. The guard must not swallow real content.
    const tail =
      paragraph('Câu 5: Nội dung câu hỏi số 5?') +
      paragraph('A. đáp án A5') +
      paragraph('B. đáp án B5') +
      paragraph('C. đáp án C5') +
      paragraph('D. đáp án D5');
    await expect(importWith(tail)).resolves.toMatchObject({ count: 5 });
  });
});

/**
 * A header-less grid is recognised by shape alone, so the shape has to carry its weight.
 * These are the tables that look like a key and are not one.
 */
describe('answer key carriers — what must not be read as a key', () => {
  it('leaves a small two-column table alone', async () => {
    // A rubric, a mark scheme, a legend: two columns of number beside letter, and nothing
    // to do with the questions.
    const tail = paragraph('THANG ĐIỂM') + table(row('Mức', 'Điểm'), row('1', 'A'), row('2', 'B'));
    await expect(importWith(tail)).resolves.toEqual({ count: 4, answers: ['', '', '', ''] });
  });

  it('leaves a grid whose numbers do not ascend alone', async () => {
    const tail = paragraph('BẢNG') + table(row('3', '1', '4', '2'), row('B', 'C', 'A', 'D'));
    await expect(importWith(tail)).resolves.toEqual({ count: 4, answers: ['', '', '', ''] });
  });

  it('still reads a headed table however few rows it has', async () => {
    // A header states intent, so it needs no corroboration from its size.
    const tail = paragraph('ĐÁP ÁN') + table(row('Câu', 'Đáp án'), row('1', 'B'), row('2', 'C'));
    await expect(importWith(tail)).resolves.toMatchObject({ count: 4 });
  });
});
