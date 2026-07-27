import { describe, expect, it } from 'vitest';
import { examImportDraftSchema } from '../src/draft/exam-import-draft';
import { validateExamImportDraft } from '../src/draft/exam-import-validation';
import {
  AikenParseError,
  MAX_AIKEN_INPUT_CHARACTERS,
  parseAiken,
  type AikenDiagnosticCode,
  type AikenParseMetadata
} from '../src/interchange/aiken';

const metadata: AikenParseMetadata = {
  assetId: 'asset-aiken-1',
  fileName: 'sample.aiken',
  title: 'Sample Aiken exam'
};

const twoQuestions = `What is the capital of France?
A. Berlin
B. Paris
C. Madrid
D. Rome
ANSWER: B

Từ nào đồng nghĩa với "nhanh"?
A. Chậm
B. Yếu
C. Mau
D. Thấp
ANSWER: C`;

function parseError(input: string): AikenParseError {
  try {
    parseAiken(input, metadata);
  } catch (error) {
    expect(error).toBeInstanceOf(AikenParseError);

    return error as AikenParseError;
  }

  throw new Error('Expected Aiken parsing to fail');
}

function diagnosticCodes(error: AikenParseError): AikenDiagnosticCode[] {
  return error.diagnostics.map((entry) => entry.code);
}

describe('Aiken parser', () => {
  it('builds a validated deterministic draft with Unicode questions and answer keys', () => {
    const first = parseAiken(twoQuestions, metadata);
    const second = parseAiken(twoQuestions, metadata);
    const validation = validateExamImportDraft(first, {
      enabledQuestionKinds: new Set(['choice']),
      sanitizeHtml: (html) => html
    });

    expect(second).toEqual(first);
    expect(examImportDraftSchema.safeParse(first).success).toBe(true);
    expect(validation).toMatchObject({ publishable: true, findings: [] });
    expect(first.source).toEqual({
      assetId: 'asset-aiken-1',
      fileName: 'sample.aiken',
      mimeType: 'text/plain; charset=utf-8',
      extractor: 'aiken'
    });

    const questions = first.sections[0]!.questions;
    expect(questions).toHaveLength(2);
    expect(questions[0]).toMatchObject({
      id: 'aiken-question-1',
      kind: 'choice',
      promptHtml: '<p>What is the capital of France?</p>',
      confidence: 'medium',
      review: 'clean',
      answerKey: {
        kind: 'choice',
        correctOptionIds: ['aiken-question-1-option-b'],
        agreement: 'single_source'
      }
    });
    expect(questions[1]).toMatchObject({
      id: 'aiken-question-2',
      kind: 'choice',
      promptHtml: '<p>Từ nào đồng nghĩa với &quot;nhanh&quot;?</p>',
      answerKey: {
        kind: 'choice',
        correctOptionIds: ['aiken-question-2-option-c']
      },
      provenance: [
        {
          start: { blockIndex: 7, runIndex: 0 },
          end: { blockIndex: 12, runIndex: 0 },
          pageStart: null,
          pageEnd: null
        }
      ]
    });
    expect(first.fieldStates.every((state) => state.origin === 'deterministic')).toBe(true);
  });

  it('normalizes a UTF-8 BOM and CRLF without changing the result', () => {
    const normalized = parseAiken(twoQuestions, metadata);
    const windowsInput = `\uFEFF${twoQuestions.replace(/\n/gu, '\r\n')}`;

    expect(parseAiken(windowsInput, metadata)).toEqual(normalized);
  });

  it('escapes authored HTML in prompts and options', () => {
    const draft = parseAiken(
      `<script>alert("x")</script>
A. Fish & chips
B. Two
C. Three
D. Four
ANSWER: A`,
      metadata
    );
    const question = draft.sections[0]!.questions[0]!;

    expect(question.promptHtml).toBe('<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>');
    expect(question.kind === 'choice' ? question.options[0]!.html : null).toBe('<p>Fish &amp; chips</p>');
  });

  it('requires a blank line between questions', () => {
    const error = parseError(`First question
A. One
B. Two
C. Three
D. Four
ANSWER: A
Second question
A. One
B. Two
C. Three
D. Four
ANSWER: B`);

    expect(error.diagnostics).toEqual([
      {
        kind: 'syntax',
        code: 'QUESTION_SEPARATOR_REQUIRED',
        line: 7,
        column: 1,
        message: 'Line 7: A blank line must separate consecutive Aiken questions'
      }
    ]);
  });

  it('reports malformed option sets with line references', () => {
    const error = parseError(`Broken options
A. One
A. Duplicate
C. Three
D. Four
ANSWER: C`);

    expect(diagnosticCodes(error)).toEqual([
      'DUPLICATE_OPTION',
      'OPTION_OUT_OF_ORDER',
      'OPTION_OUT_OF_ORDER',
      'MISSING_OPTION'
    ]);
    expect(error.diagnostics.map((entry) => entry.line)).toEqual([3, 4, 5, 6]);
    expect(error.diagnostics.every((entry) => entry.message.startsWith(`Line ${entry.line}:`))).toBe(true);
  });

  it('reports unsupported labels and multiple answers instead of dropping them', () => {
    const unsupportedOption = parseError(`Unsupported option
A. One
B. Two
C. Three
D. Four
E. Five
ANSWER: A`);
    const multipleAnswers = parseError(`Multiple answers
A. One
B. Two
C. Three
D. Four
ANSWER: A, B`);

    expect(unsupportedOption.diagnostics).toMatchObject([
      { kind: 'unsupported', code: 'UNSUPPORTED_OPTION_LABEL', line: 6 }
    ]);
    expect(multipleAnswers.diagnostics).toMatchObject([
      { kind: 'unsupported', code: 'UNSUPPORTED_MULTIPLE_ANSWERS', line: 6 }
    ]);
  });

  it('reports metadata and duplicate answer lines explicitly', () => {
    const metadataError = parseError(`# category

Question
A. One
B. Two
C. Three
D. Four
ANSWER: A`);
    const duplicateAnswer = parseError(`Question
A. One
B. Two
C. Three
D. Four
ANSWER: A
ANSWER: B`);

    expect(metadataError.diagnostics).toEqual([
      {
        kind: 'unsupported',
        code: 'UNSUPPORTED_METADATA',
        line: 1,
        column: 1,
        message: 'Line 1: Metadata and comment lines are outside the supported Aiken profile'
      }
    ]);
    expect(duplicateAnswer.diagnostics).toMatchObject([{ kind: 'syntax', code: 'DUPLICATE_ANSWER', line: 7 }]);
  });

  it('reports multiline question and option constructs as unsupported', () => {
    const multilineQuestion = parseError(`Question starts here
and continues here
A. One
B. Two
C. Three
D. Four
ANSWER: A`);
    const multilineOption = parseError(`Question
A. First line
continued option text
B. Two
C. Three
D. Four
ANSWER: A`);

    expect(multilineQuestion.diagnostics).toMatchObject([
      { kind: 'unsupported', code: 'UNSUPPORTED_MULTILINE_QUESTION', line: 2 }
    ]);
    expect(multilineOption.diagnostics).toMatchObject([
      { kind: 'unsupported', code: 'UNSUPPORTED_OPTION_CONTINUATION', line: 3 }
    ]);
  });

  it('fails with typed diagnostics for empty and invalidly decoded input', () => {
    const empty = parseError(' \n\n');
    const invalidUtf8 = parseError(`Question \uFFFD
A. One
B. Two
C. Three
D. Four
ANSWER: A`);

    expect(empty.diagnostics).toEqual([
      {
        kind: 'syntax',
        code: 'EMPTY_INPUT',
        line: 1,
        column: 1,
        message: 'Line 1: Aiken input contains no questions'
      }
    ]);
    expect(invalidUtf8.diagnostics).toMatchObject([{ kind: 'syntax', code: 'INVALID_UTF8_TEXT', line: 1 }]);
  });

  it('rejects oversized input before parsing blocks', () => {
    const error = parseError('x'.repeat(MAX_AIKEN_INPUT_CHARACTERS + 1));

    expect(error.diagnostics).toMatchObject([{ code: 'INPUT_TOO_LARGE', line: 1 }]);
  });
});
