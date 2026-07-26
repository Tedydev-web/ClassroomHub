import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createExamImportDraftFromRuns } from '../src/draft/exam-import-pipeline';
import { createValidatedExamImportDraftFromRuns } from '../src/draft/exam-import-pipeline';
import { examImportDraftToExtractedExam } from '../src/metrics/exam-import-draft-metrics';
import { scoreExtraction } from '../src/metrics/exam-extraction-metrics';
import { referenceExamSchema } from '../src/metrics/reference-exam';
import { readDocxRuns } from '../src/docx/read-docx-runs';
import { emptyFormatting, type SourceRun } from '../src/source-run';

const FIXTURE_ROOT = join(__dirname, '..', '..', '..', 'fixtures', 'exams');
const DOCX_PATH = join(FIXTURE_ROOT, '2026-en-on-luyen-03-scan-converted.docx');
const REFERENCE_PATH = join(FIXTURE_ROOT, 'references', '2026-en-on-luyen-03-scan-converted.reference.json');
const source = {
  assetId: 'asset-1',
  fileName: 'exam.docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  extractor: 'docx'
} as const;

function block(index: number, text: string): SourceRun {
  return {
    text,
    formatting: emptyFormatting(),
    block: {
      kind: 'paragraph',
      index,
      listNumber: null,
      tableRef: null
    },
    math: null,
    image: null,
    location: { blockIndex: index, runIndex: 0 }
  };
}

describe('exam import pipeline', () => {
  it('segments, harvests and reconciles through one deterministic entrypoint', () => {
    const draft = createExamImportDraftFromRuns(
      [block(0, 'Question 1. Choose the answer.'), block(1, 'A. OneB. TwoC. ThreeD. Four'), block(2, 'Đáp án: C')],
      source
    );
    const question = draft.sections[0]?.questions[0];
    if (question?.kind !== 'choice') throw new Error('Expected a choice question');

    expect(question.answerKey).toMatchObject({
      kind: 'choice',
      correctOptionIds: ['question-1-option-c'],
      agreement: 'single_source'
    });
    expect(question.review).toBe('clean');
    expect(draft.diagnostics.map((diagnostic) => diagnostic.code)).toContain('POINTS_DEFAULTED');
    expect(draft.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('ANSWER_KEY_MISSING');

    const validated = createValidatedExamImportDraftFromRuns(
      [block(0, 'Question 1. Choose the answer.'), block(1, 'A. OneB. TwoC. ThreeD. Four'), block(2, 'Đáp án: C')],
      source,
      {
        enabledQuestionKinds: new Set(['choice', 'true_false_group', 'short_answer', 'numeric', 'essay']),
        sanitizeHtml: (html) => html
      }
    );
    expect(validated.publishable).toBe(true);
    expect(validated.draft).not.toBeNull();
  });

  it('keeps a keyless document complete and explicitly unresolved', () => {
    const draft = createExamImportDraftFromRuns(
      [block(0, 'Question 1. Choose.'), block(1, 'A. OneB. TwoC. ThreeD. Four')],
      source
    );
    const question = draft.sections[0]?.questions[0];

    expect(question?.answerKey).toBeNull();
    expect(question?.review).toBe('unresolved');
    expect(draft.diagnostics.map((diagnostic) => diagnostic.code)).toContain('ANSWER_KEY_MISSING');
  });

  it('keeps structurally flagged questions in review after answer reconciliation', () => {
    const draft = createExamImportDraftFromRuns(
      [block(0, 'Question 1. Choose.'), block(1, 'A. OneB. TwoC. Three'), block(2, 'Đáp án: B')],
      source
    );
    const question = draft.sections[0]?.questions[0];

    expect(question?.answerKey).not.toBeNull();
    expect(question?.review).toBe('needs_attention');
    expect(draft.diagnostics.map((diagnostic) => diagnostic.code)).toContain('OPTION_SET_INCOMPLETE');
  });

  it('scores the verified reference at full structural accuracy without inventing answer keys', async () => {
    const bytes = new Uint8Array(readFileSync(DOCX_PATH));
    const read = await readDocxRuns(bytes);
    const draft = createExamImportDraftFromRuns(read.runs, {
      ...source,
      assetId: 'reference',
      fileName: '2026-en-on-luyen-03-scan-converted.docx'
    });
    const reference = referenceExamSchema.parse(JSON.parse(readFileSync(REFERENCE_PATH, 'utf8')));
    const metrics = scoreExtraction(reference, examImportDraftToExtractedExam(draft));

    expect(metrics).toMatchObject({
      questionRecall: 1,
      kindAccuracy: 1,
      groupingAccuracy: 1,
      optionCountAccuracy: 1,
      answerKeyAccuracy: null,
      optionFidelity: null,
      counts: {
        referenceQuestions: 40,
        extractedQuestions: 40,
        matchedQuestions: 40,
        spuriousQuestions: 0
      },
      missingQuestionNumbers: [],
      optionCountMismatches: []
    });
    expect(
      draft.sections.flatMap((section) => section.questions).every((question) => question.answerKey === null)
    ).toBe(true);
  });
});
