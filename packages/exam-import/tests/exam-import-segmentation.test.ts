import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDocxRuns } from '../src/docx/read-docx-runs';
import { examImportDraftSchema, type ExamImportSourceSpan } from '../src/draft/exam-import-draft';
import { segmentExamImportRuns } from '../src/draft/exam-import-segmentation';
import { validateExamImportDraft } from '../src/draft/exam-import-validation';
import { emptyFormatting, normalizeComparableText, type RunFormatting, type SourceRun } from '../src/source-run';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const REFERENCE_DOCX = join(
  __dirname,
  '..',
  '..',
  '..',
  'fixtures',
  'exams',
  '2026-en-on-luyen-03-scan-converted.docx'
);
const G12_PRACTICE_TEST_DOCX = join(__dirname, '..', '..', '..', 'fixtures', 'exams', '2026-g12-practice-test-2.docx');

type BlockOptions = {
  formatting?: Partial<RunFormatting>;
  kind?: SourceRun['block']['kind'];
  listNumber?: string | null;
  table?: {
    tableIndex: number;
    row: number;
    column: number;
  };
};

function block(index: number, text: string, options: BlockOptions = {}): SourceRun {
  const tableRef = options.table
    ? {
        ...options.table,
        originRow: options.table.row,
        originColumn: options.table.column
      }
    : null;

  return {
    text,
    formatting: { ...emptyFormatting(), ...options.formatting },
    block: {
      kind: options.kind ?? (tableRef ? 'table_cell' : 'paragraph'),
      index,
      listNumber: options.listNumber ?? null,
      tableRef
    },
    math: null,
    image: null,
    location: { blockIndex: index, runIndex: 0 }
  };
}

function segment(runs: SourceRun[]) {
  return segmentExamImportRuns(runs, {
    assetId: 'asset-1',
    fileName: 'exam.docx',
    mimeType: DOCX_MIME,
    extractor: 'docx'
  });
}

function comparableVisibleText(value: string): string {
  return normalizeComparableText(value).replace(/\s+([,.:;!?])/gu, '$1');
}

function decodedHtmlText(html: string): string {
  const namedEntities: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"'
  };

  return comparableVisibleText(
    html.replace(/<[^>]*>/gu, ' ').replace(/&([A-Za-z]+|#[0-9]+|#x[0-9A-Fa-f]+);/gu, (entity, value: string) => {
      if (value in namedEntities) return namedEntities[value]!;
      const codePoint = value.startsWith('#x')
        ? Number.parseInt(value.slice(2), 16)
        : value.startsWith('#')
          ? Number.parseInt(value.slice(1), 10)
          : Number.NaN;

      return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    })
  );
}

function runIsWithinProvenance(run: SourceRun, item: { provenance: ExamImportSourceSpan[] }): boolean {
  return item.provenance.some((span) => {
    const afterStart =
      run.location.blockIndex > span.start.blockIndex ||
      (run.location.blockIndex === span.start.blockIndex && run.location.runIndex >= span.start.runIndex);
    const beforeEnd =
      run.location.blockIndex < span.end.blockIndex ||
      (run.location.blockIndex === span.end.blockIndex && run.location.runIndex <= span.end.runIndex);

    return afterStart && beforeEnd;
  });
}

function sourceTextForProvenance(runs: SourceRun[], item: { provenance: ExamImportSourceSpan[] }): string {
  let previousBlock = -1;

  const sourceText = runs
    .filter((run) => runIsWithinProvenance(run, item))
    .map((run) => {
      const listNumber = run.location.blockIndex === previousBlock ? '' : (run.block.listNumber ?? '');
      previousBlock = run.location.blockIndex;

      return `${listNumber} ${run.text}`;
    })
    .join(' ');

  return comparableVisibleText(sourceText.replace(/[●•▪]/gu, ' '));
}

describe('exam import segmentation', () => {
  it('keeps answer-key highlighting out of the rendered option html', () => {
    const optionRuns = [
      block(1, 'A. First'),
      block(1, 'B. Second', { formatting: { highlight: '#A9A9A9' } }),
      block(1, 'C. ThirdD. Fourth')
    ];
    optionRuns.forEach((run, runIndex) => {
      run.location.runIndex = runIndex;
    });
    const draft = segment([block(0, 'Question 1. Choose the correct answer.'), ...optionRuns]);
    const question = draft.sections[0]?.questions[0];
    if (question?.kind !== 'choice') throw new Error('Expected a choice question');

    expect(question.options.map((option) => option.html).join('')).not.toContain('background-color');
    expect(question.options[1]?.html).toBe('<p>Second</p>');
  });

  it('preserves bold, italic and underline in the rendered option html', () => {
    const optionRuns = [
      block(1, 'A. '),
      block(1, 'plain'),
      block(1, 'B. '),
      block(1, 'strong', { formatting: { bold: true } }),
      block(1, 'C. '),
      block(1, 'stressed', { formatting: { italic: true } }),
      block(1, 'D. '),
      block(1, 'marked', { formatting: { underline: true } })
    ];
    optionRuns.forEach((run, runIndex) => {
      run.location.runIndex = runIndex;
    });
    const draft = segment([block(0, 'Question 1. Choose the correct answer.'), ...optionRuns]);
    const question = draft.sections[0]?.questions[0];
    if (question?.kind !== 'choice') throw new Error('Expected a choice question');

    expect(question.options.map((option) => option.html)).toEqual([
      '<p>plain</p>',
      '<p><strong>strong</strong></p>',
      '<p><em>stressed</em></p>',
      '<p><u>marked</u></p>'
    ]);
  });

  it('recognizes CEM sections, question markers, points, cognitive levels and concatenated options', () => {
    const draft = segment([
      block(0, 'Midterm exam'),
      block(1, 'PHẦN I. Multiple choice'),
      block(2, 'Question 1. (2 điểm) [2, VD] Choose the correct answer.'),
      block(3, 'A. FirstB. SecondC. ThirdD. Fourth'),
      block(4, 'HẾT'),
      block(5, 'Question 2. Must not be imported.')
    ]);

    expect(draft.title).toBe('Midterm exam');
    expect(draft.sections).toHaveLength(1);
    expect(draft.sections[0]?.title).toBe('PHẦN I. Multiple choice');
    expect(draft.sections[0]?.questions).toHaveLength(1);
    expect(draft.sections[0]?.questions[0]).toMatchObject({
      kind: 'choice',
      sourceNumber: '1',
      points: 2,
      cognitiveLevel: 'VD'
    });
    const question = draft.sections[0]?.questions[0];
    expect(question?.promptHtml).toContain('Choose the correct answer.');
    if (question?.kind !== 'choice') throw new Error('Expected a choice question');

    expect(question.options.map((option) => option.sourceLabel)).toEqual(['A', 'B', 'C', 'D']);
    expect(question.options.map((option) => option.html)).toEqual([
      '<p>First</p>',
      '<p>Second</p>',
      '<p>Third</p>',
      '<p>Fourth</p>'
    ]);
  });

  it('uses resolved Word list labels when option letters are absent from text', () => {
    const draft = segment([
      block(0, 'Question 6. Which statement is correct?'),
      block(1, 'First', { kind: 'list_item', listNumber: 'A.' }),
      block(2, 'Second', { kind: 'list_item', listNumber: 'B.' }),
      block(3, 'Third', { kind: 'list_item', listNumber: 'C.' }),
      block(4, 'Fourth', { kind: 'list_item', listNumber: 'D.' })
    ]);
    const question = draft.sections[0]?.questions[0];
    if (question?.kind !== 'choice') throw new Error('Expected a choice question');

    expect(question.options.map((option) => [option.sourceLabel, option.html])).toEqual([
      ['A', '<p>First</p>'],
      ['B', '<p>Second</p>'],
      ['C', '<p>Third</p>'],
      ['D', '<p>Fourth</p>']
    ]);
  });

  it('reattaches a trailing option to the oldest incomplete question by label', () => {
    const draft = segment([
      block(0, 'Question 1. First question'),
      block(1, 'A. OneB. TwoC. Three'),
      block(2, 'Question 2. Second question'),
      block(3, 'D. Four'),
      block(4, 'A. AlphaB. BetaC. GammaD. Delta')
    ]);
    const questions = draft.sections[0]?.questions ?? [];
    if (questions[0]?.kind !== 'choice' || questions[1]?.kind !== 'choice') {
      throw new Error('Expected two choice questions');
    }

    expect(questions[0].options.map((option) => option.html)).toEqual([
      '<p>One</p>',
      '<p>Two</p>',
      '<p>Three</p>',
      '<p>Four</p>'
    ]);
    expect(questions[1].options.map((option) => option.html)).toEqual([
      '<p>Alpha</p>',
      '<p>Beta</p>',
      '<p>Gamma</p>',
      '<p>Delta</p>'
    ]);
  });

  it('does not parse option-like prose as an option marker', () => {
    const draft = segment([
      block(0, 'Question 1. Vitamin D. supports healthy bones.'),
      block(1, 'A. OneB. TwoC. ThreeD. Four')
    ]);
    const question = draft.sections[0]?.questions[0];
    if (question?.kind !== 'choice') throw new Error('Expected a choice question');

    expect(question.promptHtml).toContain('Vitamin D. supports healthy bones.');
    expect(question.options.map((option) => option.sourceLabel)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('keeps resolved list options with the current question instead of stealing them for an older one', () => {
    const draft = segment([
      block(0, 'Question 1. First question'),
      block(1, 'A. OneB. TwoC. Three'),
      block(2, 'Question 2. Second question'),
      block(3, 'Alpha', { kind: 'list_item', listNumber: 'A.' }),
      block(4, 'Beta', { kind: 'list_item', listNumber: 'B.' }),
      block(5, 'Gamma', { kind: 'list_item', listNumber: 'C.' }),
      block(6, 'Delta', { kind: 'list_item', listNumber: 'D.' })
    ]);
    const questions = draft.sections[0]?.questions ?? [];
    if (questions[0]?.kind !== 'choice' || questions[1]?.kind !== 'choice') {
      throw new Error('Expected two choice questions');
    }

    expect(questions[0].options.map((option) => option.sourceLabel)).toEqual(['A', 'B', 'C']);
    expect(questions[1].options.map((option) => option.sourceLabel)).toEqual(['A', 'B', 'C', 'D']);
    expect(draft.diagnostics.map((diagnostic) => diagnostic.code)).toContain('OPTION_SET_INCOMPLETE');
  });

  it('classifies lowercase items as true-false statements only in a corroborating section', () => {
    const draft = segment([
      block(0, 'PHẦN II. Câu trắc nghiệm đúng sai'),
      block(1, 'Câu 1. Xác định tính đúng sai.'),
      block(2, 'Mệnh đề thứ nhất', { kind: 'list_item', listNumber: 'a.' }),
      block(3, 'Mệnh đề thứ hai', { kind: 'list_item', listNumber: 'b.' }),
      block(4, 'Mệnh đề thứ ba', { kind: 'list_item', listNumber: 'c.' }),
      block(5, 'Mệnh đề thứ tư', { kind: 'list_item', listNumber: 'd.' })
    ]);
    const question = draft.sections[0]?.questions[0];
    if (question?.kind !== 'true_false_group') throw new Error('Expected a true-false group');

    expect(question.statements.map((statement) => statement.sourceLabel)).toEqual(['a', 'b', 'c', 'd']);
    expect(question.scoring).toEqual({ mode: 'tiered', tiers: [0, 0.1, 0.25, 0.5, 1] });
  });

  it('keeps lowercase arrangement items as prompt content when true-false is not corroborated', () => {
    const draft = segment([
      block(0, 'Question 1. a. Opening sentence'),
      block(1, 'Second sentence', { kind: 'list_item', listNumber: 'b.' }),
      block(2, 'Third sentence', { kind: 'list_item', listNumber: 'c.' }),
      block(3, 'A. a-b-cB. b-a-cC. c-a-bD. c-b-a')
    ]);
    const question = draft.sections[0]?.questions[0];
    if (question?.kind !== 'choice') throw new Error('Expected a choice question');

    expect(question.promptHtml).toContain('a. Opening sentence');
    expect(question.promptHtml).toContain('b. Second sentence');
    expect(question.promptHtml).toContain('c. Third sentence');
    expect(question.options).toHaveLength(4);
  });

  it('groups reading content with following questions and preserves insertion markers', () => {
    const draft = segment([
      block(0, 'Read the following passage and answer the questions.'),
      block(1, 'First paragraph. [I] More text. [II]'),
      block(2, 'Second paragraph. [III] More text. [IV]'),
      block(3, 'Question 1. Where does the sentence fit?'),
      block(4, 'A. [I]B. [II]C. [III]D. [IV]'),
      block(5, 'Question 2. What is the main idea?'),
      block(6, 'A. OneB. TwoC. ThreeD. Four')
    ]);

    expect(draft.sharedContents).toHaveLength(1);
    expect(draft.sharedContents[0]?.html).toContain('[I]');
    expect(draft.sharedContents[0]?.html).toContain('[IV]');
    expect(draft.sections[0]?.questions.map((question) => question.passageId)).toEqual([
      draft.sharedContents[0]?.id,
      draft.sharedContents[0]?.id
    ]);
  });

  it('preserves formatted text, Office Math and image asset references in shared content', () => {
    const passageMarker = block(0, 'Read the following passage and answer the questions.');
    const boldText = block(1, 'Formula ', { formatting: { bold: true } });
    const math = block(1, '');
    math.location.runIndex = 1;
    math.math = { latex: 'x^2' };
    const image = block(1, '');
    image.location.runIndex = 2;
    image.image = {
      assetRef: 'docx:word/media/chart.png',
      width: 320,
      height: 180,
      placement: 'inline'
    };
    const draft = segment([
      passageMarker,
      boldText,
      math,
      image,
      block(2, 'Question 1. Choose.'),
      block(3, 'A. OneB. TwoC. ThreeD. Four')
    ]);
    const html = draft.sharedContents[0]?.html ?? '';

    expect(html).toContain('<strong>Formula </strong>');
    expect(html).toContain('data-type="inline-math"');
    expect(html).toContain('data-latex="x^2"');
    expect(html).toContain('src="cid:docx%3Aword%2Fmedia%2Fchart.png"');
  });

  it('uses a resolved public URL for an embedded image after worker persistence', () => {
    const image = block(0, '');
    image.location.runIndex = 1;
    image.image = {
      assetRef: 'https://media.example.test/exam-import/org/import/image.png',
      width: 320,
      height: 180,
      placement: 'inline'
    };
    const draft = segment([block(0, 'Question 1. Choose.'), image, block(1, 'A. One B. Two C. Three D. Four')]);
    const question = draft.sections[0]?.questions[0];

    expect(question?.promptHtml).toContain('src="https://media.example.test/exam-import/org/import/image.png"');
    expect(question?.promptHtml).not.toContain('cid:');
  });

  it('preserves run formatting inside question prompts and option bodies', () => {
    const promptStart = block(0, 'Question 1. The ');
    const promptEmphasis = block(0, 'term', { formatting: { underline: true } });
    promptEmphasis.location.runIndex = 1;
    const promptEnd = block(0, ' means?');
    promptEnd.location.runIndex = 2;
    const optionMarker = block(1, 'A. ');
    const optionText = block(1, 'First');
    optionText.location.runIndex = 1;
    optionText.formatting.italic = true;
    const remainingOptions = block(1, 'B. SecondC. ThirdD. Fourth');
    remainingOptions.location.runIndex = 2;
    const draft = segment([promptStart, promptEmphasis, promptEnd, optionMarker, optionText, remainingOptions]);
    const question = draft.sections[0]?.questions[0];
    if (question?.kind !== 'choice') throw new Error('Expected a choice question');

    expect(question.promptHtml).toContain('<u>term</u>');
    expect(question.options[0]?.html).toContain('<em>First</em>');
  });

  it('preserves rich prompt content when metadata and an option boundary are present', () => {
    const promptStart = block(0, 'Question 1. (2 points) The ');
    const promptEmphasis = block(0, 'term', { formatting: { underline: true } });
    promptEmphasis.location.runIndex = 1;
    const promptEnd = block(0, ' means ');
    promptEnd.location.runIndex = 2;
    const math = block(0, '');
    math.location.runIndex = 3;
    math.math = { latex: 'x^2' };
    const options = block(0, 'A. FirstB. SecondC. ThirdD. Fourth');
    options.location.runIndex = 4;
    const draft = segment([promptStart, promptEmphasis, promptEnd, math, options]);
    const question = draft.sections[0]?.questions[0];
    if (question?.kind !== 'choice') throw new Error('Expected a choice question');

    expect(question.points).toBe(2);
    expect(question.promptHtml).toContain('<u>term</u>');
    expect(question.promptHtml).toContain('data-latex="x^2"');
  });

  it('reports passage groups that must be split at publish time', () => {
    const runs = [block(0, 'Read the following passage and answer the questions.'), block(1, 'Shared content.')];
    for (let index = 0; index < 25; index++) {
      const blockIndex = index * 2 + 2;
      runs.push(block(blockIndex, `Question ${index + 1}. Choose.`));
      runs.push(block(blockIndex + 1, 'A. OneB. TwoC. ThreeD. Four'));
    }
    const draft = segment(runs);

    expect(draft.sections[0]?.questions).toHaveLength(25);
    expect(draft.diagnostics.map((diagnostic) => diagnostic.code)).toContain('PASSAGE_GROUP_REQUIRES_SPLIT');
    const passageIds = new Set(draft.sections[0]?.questions.map((question) => question.passageId));
    expect(passageIds.size).toBe(2);
    expect(draft.sharedContents).toHaveLength(2);
    expect(draft.sharedContents[1]?.html).toBe(draft.sharedContents[0]?.html);
  });

  it('defaults wholly absent points to one and blocks partially specified point sets', () => {
    const absent = segment([
      block(0, 'Question 1. First.'),
      block(1, 'A. OneB. TwoC. ThreeD. Four'),
      block(2, 'Question 2. Second.'),
      block(3, 'A. OneB. TwoC. ThreeD. Four')
    ]);

    expect(absent.sections[0]?.questions.map((question) => question.points)).toEqual([1, 1]);
    expect(absent.diagnostics.map((diagnostic) => diagnostic.code)).toContain('POINTS_DEFAULTED');

    const mixed = segment([
      block(0, 'Question 1. (2 điểm) First.'),
      block(1, 'A. OneB. TwoC. ThreeD. Four'),
      block(2, 'Question 2. Second.'),
      block(3, 'A. OneB. TwoC. ThreeD. Four')
    ]);

    expect(mixed.sections[0]?.questions.map((question) => question.points)).toEqual([2, 1]);
    expect(mixed.diagnostics.map((diagnostic) => diagnostic.code)).toContain('POINTS_PARTIALLY_SPECIFIED');
    expect(mixed.diagnostics.find((diagnostic) => diagnostic.code === 'POINTS_PARTIALLY_SPECIFIED')?.blocking).toBe(
      true
    );
  });

  it('excludes solution scope until the next question marker', () => {
    const draft = segment([
      block(0, 'PHẦN I. Tự luận'),
      block(1, 'Câu 1. Prove the claim.'),
      block(2, 'Lời giải'),
      block(3, 'The answer is 42.'),
      block(4, 'Câu 2. Explain the result.')
    ]);

    expect(draft.sections[0]?.questions[0]?.promptHtml).not.toContain('The answer is 42.');
    expect(draft.sections[0]?.questions[1]?.promptHtml).toContain('Explain the result.');
  });

  it('uses a table row content cell as shared content for questions in the sibling cell', () => {
    const draft = segment([
      block(0, 'Shared table passage.', { table: { tableIndex: 0, row: 0, column: 0 } }),
      block(1, 'Question 1. Choose.', { table: { tableIndex: 0, row: 0, column: 1 } }),
      block(2, 'A. OneB. TwoC. ThreeD. Four', {
        table: { tableIndex: 0, row: 0, column: 1 }
      }),
      block(3, 'Question 2. Outside the table.'),
      block(4, 'A. OneB. TwoC. ThreeD. Four')
    ]);
    const questions = draft.sections[0]?.questions ?? [];

    expect(draft.sharedContents).toHaveLength(1);
    expect(draft.sharedContents[0]?.html).toContain('Shared table passage.');
    expect(questions[0]?.passageId).toBe(draft.sharedContents[0]?.id);
    expect(questions[1]?.passageId).toBeNull();
  });

  it('recognizes row-wise choice options split across table cells', () => {
    const draft = segment([
      block(0, 'Read the following passage and choose the best option.'),
      block(1, 'The first blank is (1), and the second blank is (2).'),
      block(2, 'Question 1: A. Alpha', { table: { tableIndex: 0, row: 0, column: 0 } }),
      block(3, 'B. Beta', { table: { tableIndex: 0, row: 0, column: 1 } }),
      block(4, 'C. Gamma', { table: { tableIndex: 0, row: 0, column: 2 } }),
      block(5, 'D. Delta', { table: { tableIndex: 0, row: 0, column: 3 } }),
      block(6, 'Question 2: A. One', { table: { tableIndex: 0, row: 1, column: 0 } }),
      block(7, 'B. Two', { table: { tableIndex: 0, row: 1, column: 1 } }),
      block(8, 'C. Three', { table: { tableIndex: 0, row: 1, column: 2 } }),
      block(9, 'D. Four', { table: { tableIndex: 0, row: 1, column: 3 } })
    ]);
    const questions = draft.sections[0]?.questions ?? [];

    expect(questions).toHaveLength(2);
    expect(draft.sharedContents).toHaveLength(1);
    expect(questions.every((question) => question.passageId === draft.sharedContents[0]?.id)).toBe(true);
    expect(questions.map((question) => question.kind)).toEqual(['choice', 'choice']);
    expect(
      questions.map((question) =>
        question.kind === 'choice' ? question.options.map((option) => option.sourceLabel) : []
      )
    ).toEqual([
      ['A', 'B', 'C', 'D'],
      ['A', 'B', 'C', 'D']
    ]);
    expect(draft.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('QUESTION_STRUCTURE_UNRESOLVED');
  });

  it('starts a new shared passage for a leaflet and ignores a decorated end marker', () => {
    const draft = segment([
      block(0, 'Read the following advertisement and choose the best option.'),
      block(1, 'First shared passage.'),
      block(2, 'Question 1. Choose.'),
      block(3, 'A. OneB. TwoC. ThreeD. Four'),
      block(4, 'Read the following leaflet and choose the best option.'),
      block(5, 'Second shared passage.'),
      block(6, 'Question 2. Choose.'),
      block(7, 'A. AlphaB. BetaC. GammaD. Delta'),
      block(8, '----- The end -----'),
      block(9, 'Question 3. Must not be imported.')
    ]);
    const questions = draft.sections.flatMap((section) => section.questions);

    expect(draft.sections).toHaveLength(2);
    expect(draft.sharedContents).toHaveLength(2);
    expect(questions).toHaveLength(2);
    expect(questions[0]?.passageId).toBe(draft.sharedContents[0]?.id);
    expect(questions[1]?.passageId).toBe(draft.sharedContents[1]?.id);
    expect(draft.sharedContents[1]?.html).toContain('Second shared passage.');
    expect(draft.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('OPTION_CONTINUATION_ATTACHED');
  });

  it('uses ranged instructions as section and shared-passage boundaries without contaminating options', () => {
    const draft = segment([
      block(0, 'PRACTICE TEST'),
      block(1, 'Choose the correct option that best fits each of the numbered blanks from 1 to 2.'),
      block(2, 'First passage contains blanks (1) ______ and (2) ______.'),
      block(3, 'Question 1. A. OneB. TwoC. ThreeD. Four'),
      block(4, 'Question 2. A. AlphaB. BetaC. GammaD. Delta'),
      block(5, 'Choose the best arrangement of utterances or sentences'),
      block(6, 'Question 3.'),
      block(7, 'a. First sentence'),
      block(8, 'b. Second sentence'),
      block(9, 'A. a – bB. b – aC. a – aD. b – b'),
      block(10, 'Choose the correct option that best fits each of the numbered blanks from 4 to 5.'),
      block(11, 'Second passage contains blanks (4) ______ and (5) ______.'),
      block(12, 'Question 4. A. RedB. BlueC. GreenD. Black'),
      block(13, 'Question 5. A. NorthB. SouthC. EastD. West'),
      block(14, 'Choose the correct answer to each of the questions from 6 to 7.'),
      block(15, 'Reading passage shared by questions six and seven.'),
      block(16, 'Question 6. First reading question? A. OneB. TwoC. ThreeD. Four'),
      block(17, 'Question 7. Second reading question? A. OneB. TwoC. ThreeD. Four')
    ]);
    const questions = draft.sections.flatMap((section) => section.questions);

    expect(draft.sections.map((section) => section.title)).toEqual([
      'Choose the correct option that best fits each of the numbered blanks from 1 to 2.',
      'Choose the best arrangement of utterances or sentences',
      'Choose the correct option that best fits each of the numbered blanks from 4 to 5.',
      'Choose the correct answer to each of the questions from 6 to 7.'
    ]);
    expect(draft.sharedContents).toHaveLength(3);
    expect(questions.map((question) => question.passageId)).toEqual([
      draft.sharedContents[0]?.id,
      draft.sharedContents[0]?.id,
      null,
      draft.sharedContents[1]?.id,
      draft.sharedContents[1]?.id,
      draft.sharedContents[2]?.id,
      draft.sharedContents[2]?.id
    ]);
    expect(draft.sharedContents[0]?.html).toContain('First passage');
    expect(draft.sharedContents[1]?.html).toContain('Second passage');
    expect(draft.sharedContents[2]?.html).toContain('Reading passage');
    expect(
      questions.flatMap((question) => (question.kind === 'choice' ? question.options : [])).map((option) => option.html)
    ).not.toEqual(expect.arrayContaining([expect.stringMatching(/Choose the|passage contains|Reading passage/u)]));
    expect(draft.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('OPTION_CONTINUATION_ATTACHED');
  });

  it('keeps ranged reading instructions as separate sections', () => {
    const firstInstruction =
      'Read the following passage and mark the letter A, B, C, or D to indicate the correct option that best fits each of the numbered blanks from 1 to 2.';
    const secondInstruction =
      'Read the following passage and mark the letter A, B, C, or D to indicate the correct answer to each of the questions from 3 to 4.';
    const draft = segment([
      block(0, 'PRACTICE TEST'),
      block(1, firstInstruction),
      block(2, 'First shared passage.'),
      block(3, 'Question 1. A. OneB. TwoC. ThreeD. Four'),
      block(4, 'Question 2. A. AlphaB. BetaC. GammaD. Delta'),
      block(5, secondInstruction),
      block(6, 'Second shared passage.'),
      block(7, 'Question 3. A. RedB. BlueC. GreenD. Black'),
      block(8, 'Question 4. A. NorthB. SouthC. EastD. West')
    ]);

    expect(draft.sections.map((section) => section.title)).toEqual([firstInstruction, secondInstruction]);
    expect(draft.sections.map((section) => section.questions.length)).toEqual([2, 2]);
    expect(draft.sharedContents).toHaveLength(2);
    expect(draft.sections[0]?.questions.every((question) => question.passageId === draft.sharedContents[0]?.id)).toBe(
      true
    );
    expect(draft.sections[1]?.questions.every((question) => question.passageId === draft.sharedContents[1]?.id)).toBe(
      true
    );
  });

  it('prefers the substantive bold title over name and class form fields in the first block', () => {
    const firstBlockRuns = [
      block(0, 'Name: ', { formatting: { bold: true } }),
      block(0, '________________'),
      block(0, 'Class: ', { formatting: { bold: true } }),
      block(0, '12___'),
      block(0, 'PRACTICE TEST – TOPIC 2', { formatting: { bold: true } })
    ].map((run, runIndex) => ({ ...run, location: { ...run.location, runIndex } }));
    const draft = segment([
      ...firstBlockRuns,
      block(1, 'Question 1. Choose.'),
      block(2, 'A. OneB. TwoC. ThreeD. Four')
    ]);

    expect(draft.title).toBe('PRACTICE TEST – TOPIC 2');
  });

  it('blocks publishing when source content has no structural owner', () => {
    const draft = segment([
      block(0, 'PRACTICE TEST'),
      block(1, 'Unrecognized source content that must not be discarded.'),
      block(2, 'SECTION I. Essay'),
      block(3, 'Question 1. Explain your answer.')
    ]);
    const validation = validateExamImportDraft(draft, {
      enabledQuestionKinds: new Set(['essay']),
      sanitizeHtml: (html) => html
    });

    expect(draft.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'UNASSIGNED_SOURCE_CONTENT',
          blocking: true,
          provenance: expect.arrayContaining([
            expect.objectContaining({
              start: { blockIndex: 1, runIndex: 0 }
            })
          ])
        })
      ])
    );
    expect(validation.publishable).toBe(false);
    expect(validation.findings.map((finding) => finding.code)).toContain('UNASSIGNED_SOURCE_CONTENT');
  });

  it('does not discard a pending passage when a section starts or the document ends', () => {
    const beforeSection = segment([
      block(0, 'PRACTICE TEST'),
      block(1, 'Choose the correct answer to each of the questions from 1 to 2.'),
      block(2, 'Passage without any owning question.'),
      block(3, 'SECTION II. Essay'),
      block(4, 'Question 1. Explain your answer.')
    ]);
    const beforeEnd = segment([
      block(0, 'PRACTICE TEST'),
      block(1, 'Choose the correct answer to each of the questions from 1 to 2.'),
      block(2, 'Passage without any owning question.'),
      block(3, 'THE END')
    ]);

    expect(beforeSection.diagnostics.map((diagnostic) => diagnostic.code)).toContain('UNASSIGNED_SOURCE_CONTENT');
    expect(beforeEnd.diagnostics.map((diagnostic) => diagnostic.code)).toContain('UNASSIGNED_SOURCE_CONTENT');
  });

  it('keeps an option-count instruction inside its current question', () => {
    const draft = segment([
      block(0, 'PRACTICE TEST'),
      block(1, 'Question 1.'),
      block(2, 'Choose from 1 to 2 options before answering.'),
      block(3, 'A. OneB. TwoC. ThreeD. Four')
    ]);
    const question = draft.sections[0]?.questions[0];
    if (question?.kind !== 'choice') throw new Error('Expected a choice question');

    expect(draft.sections).toHaveLength(1);
    expect(question.promptHtml).toContain('Choose from 1 to 2 options before answering.');
    expect(question.options).toHaveLength(4);
    expect(draft.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('UNASSIGNED_SOURCE_CONTENT');
  });

  it('ignores long bold candidate labels when choosing the title', () => {
    const firstBlockRuns = [
      block(0, 'Candidate name: ', { formatting: { bold: true } }),
      block(0, '________________'),
      block(0, 'EXAM', { formatting: { bold: true } })
    ].map((run, runIndex) => ({ ...run, location: { ...run.location, runIndex } }));
    const draft = segment([
      ...firstBlockRuns,
      block(1, 'Question 1. Choose.'),
      block(2, 'A. OneB. TwoC. ThreeD. Four')
    ]);

    expect(draft.title).toBe('EXAM');

    for (const label of ['Name', 'Candidate', 'Họ và tên']) {
      const splitLabelRuns = [
        block(0, label, { formatting: { bold: true } }),
        block(0, ': ________________'),
        block(0, 'ĐỀ THI', { formatting: { bold: true } })
      ].map((run, runIndex) => ({ ...run, location: { ...run.location, runIndex } }));
      const splitLabelDraft = segment([
        ...splitLabelRuns,
        block(1, 'Question 1. Choose.'),
        block(2, 'A. OneB. TwoC. ThreeD. Four')
      ]);

      expect(splitLabelDraft.title).toBe('ĐỀ THI');
    }
  });

  it('does not invent a passage from preamble text and preserves option continuation text', () => {
    const draft = segment([
      block(0, 'Midterm instructions'),
      block(1, 'Question 1. Choose.'),
      block(2, 'A. First optionB. SecondC. ThirdD. Fourth'),
      block(3, 'continued on the next source paragraph')
    ]);
    const question = draft.sections[0]?.questions[0];
    if (question?.kind !== 'choice') throw new Error('Expected a choice question');

    expect(draft.sharedContents).toEqual([]);
    expect(question.options[3]?.html).toContain('continued on the next source paragraph');
    expect(draft.diagnostics.map((diagnostic) => diagnostic.code)).toContain('OPTION_CONTINUATION_ATTACHED');
  });

  it('keeps answer tables and compact keys out of option content', () => {
    const questionRuns = [block(0, 'Question 1. Choose.'), block(1, 'A. OneB. TwoC. ThreeD. Four')];
    const tableDraft = segment([
      ...questionRuns,
      block(2, 'Câu', { table: { tableIndex: 0, row: 0, column: 0 } }),
      block(3, '1', { table: { tableIndex: 0, row: 0, column: 1 } }),
      block(4, 'Chọn', { table: { tableIndex: 0, row: 1, column: 0 } }),
      block(5, 'B', { table: { tableIndex: 0, row: 1, column: 1 } })
    ]);
    const compactDraft = segment([...questionRuns, block(2, '1B')]);
    const tableQuestion = tableDraft.sections[0]?.questions[0];
    const compactQuestion = compactDraft.sections[0]?.questions[0];
    if (tableQuestion?.kind !== 'choice' || compactQuestion?.kind !== 'choice') {
      throw new Error('Expected choice questions');
    }

    expect(tableQuestion.options[3]?.html).toBe('<p>Four</p>');
    expect(compactQuestion.options[3]?.html).toBe('<p>Four</p>');
  });

  it('preserves ordinary table structure in authored question HTML', () => {
    const draft = segment([
      block(0, 'Question 1. Use the data below.'),
      block(1, 'Year', { table: { tableIndex: 0, row: 0, column: 0 } }),
      block(2, 'Value', { table: { tableIndex: 0, row: 0, column: 1 } }),
      block(3, '2025', { table: { tableIndex: 0, row: 1, column: 0 } }),
      block(4, '42', { table: { tableIndex: 0, row: 1, column: 1 } }),
      block(5, 'A. OneB. TwoC. ThreeD. Four')
    ]);
    const question = draft.sections[0]?.questions[0];

    expect(question?.promptHtml).toContain('<table>');
    expect(question?.promptHtml).toContain('<tr><td><p>Year</p></td><td><p>Value</p></td></tr>');
    expect(question?.promptHtml).toContain('<tr><td><p>2025</p></td><td><p>42</p></td></tr>');
  });

  it('preserves a rich-only math paragraph with an empty text range', () => {
    const mathRun = block(1, '');
    mathRun.math = { latex: 'x^2' };
    const draft = segment([
      block(0, 'Question 1. Evaluate the expression.'),
      mathRun,
      block(2, 'A. OneB. TwoC. ThreeD. Four')
    ]);

    expect(draft.sections[0]?.questions[0]?.promptHtml).toContain(
      '<span data-type="inline-math" data-latex="x^2"></span>'
    );
  });

  it('scopes column-major option ownership to the questions in that marker group', () => {
    const draft = segment([
      block(0, 'Question 1. Earlier question.'),
      block(1, 'A. q1aB. q1bC. q1c'),
      block(2, 'Question 2. A. q2a Question 3. A. q3a'),
      block(3, 'B. q2b'),
      block(4, 'B. q3b'),
      block(5, 'C. q2c'),
      block(6, 'C. q3c'),
      block(7, 'D. q2d'),
      block(8, 'D. q3d'),
      block(9, 'D. q1d')
    ]);
    const questions = draft.sections[0]?.questions ?? [];
    if (questions[0]?.kind !== 'choice' || questions[1]?.kind !== 'choice' || questions[2]?.kind !== 'choice') {
      throw new Error('Expected three choice questions');
    }

    expect(questions.every((question) => question.options.some((option) => option.sourceLabel === 'D'))).toBe(true);
    expect(draft.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'OPTION_OWNERSHIP_AMBIGUOUS',
          blocking: true
        })
      ])
    );
  });

  it('keeps literal paragraph options with the current question once that question owns options', () => {
    const draft = segment([
      block(0, 'Question 1. First.'),
      block(1, 'A. One'),
      block(2, 'B. Two'),
      block(3, 'C. Three'),
      block(4, 'Question 2. Second.'),
      block(5, 'A. Alpha'),
      block(6, 'B. Beta'),
      block(7, 'C. Gamma'),
      block(8, 'D. Delta')
    ]);
    const questions = draft.sections[0]?.questions;

    expect(questions?.[0]).toMatchObject({ kind: 'choice' });
    expect(questions?.[1]).toMatchObject({ kind: 'choice' });
    if (questions?.[0]?.kind !== 'choice' || questions[1]?.kind !== 'choice') {
      throw new Error('Expected choice questions');
    }
    expect(questions[0].options.map((option) => option.sourceLabel)).toEqual(['A', 'B', 'C']);
    expect(questions[1].options.map((option) => option.sourceLabel)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('does not infer boolean answers from letters embedded in ordinary words', () => {
    const draft = segment([
      block(0, 'Question 1. Evaluate the statements.'),
      block(1, 'One', { kind: 'list_item', listNumber: 'a.' }),
      block(2, 'Two', { kind: 'list_item', listNumber: 'b.' }),
      block(3, 'Three', { kind: 'list_item', listNumber: 'c.' }),
      block(4, 'Four', { kind: 'list_item', listNumber: 'd.' }),
      block(5, 'Answer: TESTS')
    ]);

    expect(draft.sections[0]?.questions[0]?.kind).toBe('unresolved');
  });

  it('reports duplicate and incomplete option structures', () => {
    const duplicate = segment([block(0, 'Question 1. Choose.'), block(1, 'A. OneA. DuplicateB. TwoC. ThreeD. Four')]);
    expect(duplicate.diagnostics.map((diagnostic) => diagnostic.code)).toContain('DUPLICATE_OPTION_LABEL');

    const incomplete = segment([block(0, 'Question 1. Choose.'), block(1, 'A. OneB. TwoC. Three')]);
    expect(incomplete.diagnostics.map((diagnostic) => diagnostic.code)).toContain('OPTION_SET_INCOMPLETE');
  });

  it('deduplicates repeated malformed option findings without failing the whole import', () => {
    const repeatedOptions = Array.from({ length: 20_002 }, () => 'A.x').join('');
    const draft = segment([block(0, 'Question 1. Choose.'), block(1, repeatedOptions)]);

    expect(draft.diagnostics.filter((diagnostic) => diagnostic.code === 'DUPLICATE_OPTION_LABEL')).toHaveLength(1);
    expect(examImportDraftSchema.safeParse(draft).success).toBe(true);
  });

  it('preserves lower-letter list numbering that starts at b as arrangement content', () => {
    const draft = segment([
      block(0, 'Question 1. a. First sentence'),
      block(1, 'Second sentence', { kind: 'list_item', listNumber: 'b.' }),
      block(2, 'Third sentence', { kind: 'list_item', listNumber: 'c.' }),
      block(3, 'Fourth sentence', { kind: 'list_item', listNumber: 'd.' }),
      block(4, 'Fifth sentence', { kind: 'list_item', listNumber: 'e.' }),
      block(5, 'A. a-b-c-d-eB. b-a-c-d-eC. c-a-b-d-eD. d-a-b-c-e')
    ]);
    const question = draft.sections[0]?.questions[0];
    if (question?.kind !== 'choice') throw new Error('Expected a choice question');

    expect(question.promptHtml).toContain('a. First sentence');
    expect(question.promptHtml).toContain('b. Second sentence');
    expect(question.promptHtml).toContain('e. Fifth sentence');
  });

  it('segments the verified reference into forty complete choice questions and five passage groups', async () => {
    const bytes = new Uint8Array(readFileSync(REFERENCE_DOCX));
    const result = await readDocxRuns(bytes);
    const draft = segmentExamImportRuns(result.runs, {
      assetId: 'reference-docx',
      fileName: '2026-en-on-luyen-03-scan-converted.docx',
      mimeType: DOCX_MIME,
      extractor: 'docx'
    });
    const questions = draft.sections.flatMap((section) => section.questions);

    expect(questions).toHaveLength(40);
    expect(questions.map((question) => question.sourceNumber)).toEqual(
      Array.from({ length: 40 }, (_, index) => String(index + 1))
    );
    expect(questions.every((question) => question.kind === 'choice')).toBe(true);
    expect(questions.every((question) => question.kind === 'choice' && question.options.length === 4)).toBe(true);
    expect(draft.sharedContents).toHaveLength(5);
    expect(questions.slice(0, 10).every((question) => question.passageId === draft.sharedContents[0]?.id)).toBe(true);
    expect(questions.slice(10, 16).every((question) => question.passageId === draft.sharedContents[1]?.id)).toBe(true);
    expect(questions.slice(16, 21).every((question) => question.passageId === draft.sharedContents[2]?.id)).toBe(true);
    expect(questions.slice(21, 27).every((question) => question.passageId === draft.sharedContents[3]?.id)).toBe(true);
    expect(questions.slice(27, 35).every((question) => question.passageId === draft.sharedContents[4]?.id)).toBe(true);
    expect(questions.slice(35).every((question) => question.passageId === null)).toBe(true);
  });

  it('segments the uploaded G12 practice test into its six instruction blocks', async () => {
    const bytes = new Uint8Array(readFileSync(G12_PRACTICE_TEST_DOCX));
    expect(bytes.byteLength).toBe(53_945);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '21c8d65a335af3b0fda01306430fc07fa7c230542a8ada1809748838e426c021'
    );
    const result = await readDocxRuns(bytes);
    const draft = segmentExamImportRuns(result.runs, {
      assetId: 'g12-practice-test-2',
      fileName: '2026-g12-practice-test-2.docx',
      mimeType: DOCX_MIME,
      extractor: 'docx'
    });
    const questions = draft.sections.flatMap((section) => section.questions);

    expect(draft.sections.map((section) => section.questions.length)).toEqual([6, 6, 5, 5, 8, 10]);
    expect(questions.map((question) => question.sourceNumber)).toEqual(
      Array.from({ length: 40 }, (_, index) => String(index + 1))
    );
    expect(questions.every((question) => question.kind === 'choice' && question.options.length === 4)).toBe(true);
    expect(draft.sharedContents).toHaveLength(5);
    expect(questions.slice(0, 6).every((question) => question.passageId === draft.sharedContents[0]?.id)).toBe(true);
    expect(questions.slice(6, 12).every((question) => question.passageId === draft.sharedContents[1]?.id)).toBe(true);
    expect(questions.slice(12, 17).every((question) => question.passageId === null)).toBe(true);
    expect(questions.slice(17, 22).every((question) => question.passageId === draft.sharedContents[2]?.id)).toBe(true);
    expect(questions.slice(22, 30).every((question) => question.passageId === draft.sharedContents[3]?.id)).toBe(true);
    expect(questions.slice(30).every((question) => question.passageId === draft.sharedContents[4]?.id)).toBe(true);
    expect(draft.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('UNASSIGNED_SOURCE_CONTENT');
    expect(draft.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'SECTION_QUESTION_RANGE_MISMATCH',
          blocking: false,
          questionId: questions[30]?.id
        })
      ])
    );
  });

  it.each([
    ['verified reference', REFERENCE_DOCX],
    ['uploaded G12 practice test', G12_PRACTICE_TEST_DOCX]
  ])('keeps every authored fragment from the %s grounded in its source span', async (_name, path) => {
    const result = await readDocxRuns(new Uint8Array(readFileSync(path)));
    const draft = segmentExamImportRuns(result.runs, {
      assetId: 'option-fidelity',
      fileName: path,
      mimeType: DOCX_MIME,
      extractor: 'docx'
    });
    const questions = draft.sections.flatMap((section) => section.questions);

    expect(questions).toHaveLength(40);
    for (const sharedContent of draft.sharedContents) {
      const sourceText = sourceTextForProvenance(result.runs, sharedContent);

      expect(sourceText).toContain(decodedHtmlText(sharedContent.html));
    }
    for (const question of questions) {
      if (question.kind !== 'choice') throw new Error(`Expected choice question ${question.sourceNumber}`);
      const sourceText = sourceTextForProvenance(result.runs, question);
      let sourceCursor = 0;

      expect(sourceText).toContain(decodedHtmlText(question.promptHtml));
      for (const option of question.options) {
        const optionText = decodedHtmlText(option.html);
        const optionIndex = sourceText.indexOf(optionText, sourceCursor);

        expect(
          optionIndex,
          `Question ${question.sourceNumber} option ${option.sourceLabel} is not source-grounded`
        ).toBeGreaterThanOrEqual(0);
        sourceCursor = optionIndex + optionText.length;
      }
    }
  });

  it('is deterministic for identical input', () => {
    const runs = [block(0, 'Question 1. Choose.'), block(1, 'A. OneB. TwoC. ThreeD. Four')];

    expect(segment(runs)).toEqual(segment(runs));
  });

  it('always emits a structurally valid draft', () => {
    const draft = segment([block(0, 'Question 1. Choose.'), block(1, 'A. OneB. TwoC. ThreeD. Four')]);

    expect(examImportDraftSchema.safeParse(draft).success).toBe(true);
  });

  it('keeps oversized section headings reviewable without emitting an invalid draft', () => {
    const draft = segment([
      block(0, `PHẦN I. ${'x'.repeat(600)}`),
      block(1, 'Question 1. Choose.'),
      block(2, 'A. OneB. TwoC. ThreeD. Four')
    ]);

    expect(draft.sections[0]?.title.length).toBe(500);
    expect(draft.diagnostics.map((diagnostic) => diagnostic.code)).toContain('SECTION_TITLE_TRUNCATED');
    expect(draft.diagnostics.find((diagnostic) => diagnostic.code === 'SECTION_TITLE_TRUNCATED')?.target).toBeNull();
    expect(examImportDraftSchema.safeParse(draft).success).toBe(true);
  });
});
