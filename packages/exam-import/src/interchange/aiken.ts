import {
  EXAM_IMPORT_SCHEMA_VERSION,
  MAX_EXAM_IMPORT_QUESTIONS_PER_SECTION,
  examImportDraftSchema,
  type ExamImportDraft,
  type ExamImportFieldState,
  type ExamImportSourceSpan
} from '../draft/exam-import-draft';

export type AikenParseMetadata = {
  assetId: string;
  fileName: string;
  title: string;
};

export type AikenDiagnosticKind = 'syntax' | 'unsupported';

export type AikenDiagnosticCode =
  | 'DRAFT_VALIDATION_FAILED'
  | 'DUPLICATE_ANSWER'
  | 'DUPLICATE_OPTION'
  | 'EMPTY_INPUT'
  | 'INVALID_UTF8_TEXT'
  | 'INPUT_TOO_LARGE'
  | 'MALFORMED_ANSWER'
  | 'MALFORMED_OPTION'
  | 'MISSING_ANSWER'
  | 'MISSING_OPTION'
  | 'MISSING_QUESTION_TEXT'
  | 'OPTION_OUT_OF_ORDER'
  | 'QUESTION_SEPARATOR_REQUIRED'
  | 'TOO_MANY_QUESTIONS'
  | 'UNSUPPORTED_CONTROL_CHARACTER'
  | 'UNSUPPORTED_METADATA'
  | 'UNSUPPORTED_MULTILINE_QUESTION'
  | 'UNSUPPORTED_MULTIPLE_ANSWERS'
  | 'UNSUPPORTED_OPTION_CONTINUATION'
  | 'UNSUPPORTED_OPTION_LABEL'
  | 'UNSUPPORTED_OPTION_MARKER';

export type AikenDiagnostic = {
  kind: AikenDiagnosticKind;
  code: AikenDiagnosticCode;
  line: number;
  column: number;
  message: string;
};

export class AikenParseError extends Error {
  constructor(readonly diagnostics: AikenDiagnostic[]) {
    super(diagnostics[0]?.message ?? 'Aiken parsing failed');
    this.name = 'AikenParseError';
  }
}

type SourceLine = {
  number: number;
  text: string;
};

type ParsedOption = {
  label: 'A' | 'B' | 'C' | 'D';
  text: string;
  line: number;
};

type ParsedQuestion = {
  prompt: string;
  startLine: number;
  endLine: number;
  options: ParsedOption[];
  answer: ParsedOption['label'];
  answerLine: number;
};

const OPTION_LABELS = ['A', 'B', 'C', 'D'] as const;
export const MAX_AIKEN_INPUT_CHARACTERS = 5 * 1024 * 1024;
const OPTION_PATTERN = /^([A-D])\.\s+(\S(?:.*\S)?)$/u;
const OPTION_PREFIX_PATTERN = /^([A-Z])\.(.*)$/u;
const UNSUPPORTED_OPTION_MARKER = /^([A-D])(?:\)|:|-)\s*/u;
const ANSWER_PATTERN = /^ANSWER:\s*([A-D])\s*$/u;
const ANSWER_PREFIX_PATTERN = /^ANSWER:(.*)$/iu;
const UNSUPPORTED_METADATA_PATTERN = /^(?:#|\/\/|::|\$CATEGORY:|\[)/u;

function diagnostic(
  kind: AikenDiagnosticKind,
  code: AikenDiagnosticCode,
  line: number,
  message: string,
  column = 1
): AikenDiagnostic {
  return { kind, code, line, column, message: `Line ${line}: ${message}` };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortDiagnostics(diagnostics: AikenDiagnostic[]): AikenDiagnostic[] {
  return [...diagnostics].sort(
    (left, right) => left.line - right.line || left.column - right.column || compareText(left.code, right.code)
  );
}

function sourceLines(input: string): SourceLine[] {
  const withoutBom = input.startsWith('\uFEFF') ? input.slice(1) : input;

  return withoutBom
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((text, index) => ({
      number: index + 1,
      text: text.trim()
    }));
}

function questionBlocks(lines: SourceLine[]): SourceLine[][] {
  const blocks: SourceLine[][] = [];
  let current: SourceLine[] = [];

  for (const line of lines) {
    if (line.text.length === 0) {
      if (current.length > 0) blocks.push(current);
      current = [];
      continue;
    }

    current.push(line);
  }
  if (current.length > 0) blocks.push(current);

  return blocks;
}

function optionLabel(value: string): ParsedOption['label'] | null {
  return OPTION_LABELS.find((label) => label === value) ?? null;
}

function unsupportedAnswerDiagnostic(line: SourceLine, payload: string): AikenDiagnostic {
  const trimmed = payload.trim();
  if (/^[A-D](?:\s*[,;]\s*[A-D])+$/u.test(trimmed)) {
    return diagnostic(
      'unsupported',
      'UNSUPPORTED_MULTIPLE_ANSWERS',
      line.number,
      'Multiple-answer Aiken questions are outside the supported profile',
      line.text.indexOf(':') + 2
    );
  }
  if (/^[A-Z]$/u.test(trimmed)) {
    return diagnostic(
      'unsupported',
      'UNSUPPORTED_OPTION_LABEL',
      line.number,
      `Answer label "${trimmed}" is outside the supported A-D option set`,
      line.text.indexOf(':') + 2
    );
  }

  return diagnostic(
    'syntax',
    'MALFORMED_ANSWER',
    line.number,
    'Answer must use exactly "ANSWER: X" where X is A, B, C, or D'
  );
}

function parseQuestionBlock(block: SourceLine[], diagnostics: AikenDiagnostic[]): ParsedQuestion | null {
  const blockDiagnostics: AikenDiagnostic[] = [];
  const promptLine = block[0]!;
  if (OPTION_PREFIX_PATTERN.test(promptLine.text) || ANSWER_PREFIX_PATTERN.test(promptLine.text)) {
    blockDiagnostics.push(
      diagnostic('syntax', 'MISSING_QUESTION_TEXT', promptLine.number, 'Question text must precede its options')
    );
  }
  if (UNSUPPORTED_METADATA_PATTERN.test(promptLine.text)) {
    diagnostics.push(
      diagnostic(
        'unsupported',
        'UNSUPPORTED_METADATA',
        promptLine.number,
        'Metadata and comment lines are outside the supported Aiken profile'
      )
    );

    return null;
  }

  const options = new Map<ParsedOption['label'], ParsedOption>();
  let answer: ParsedOption['label'] | null = null;
  let answerLine: number | null = null;
  let separatorReported = false;

  for (const line of block.slice(1)) {
    if (answer !== null || answerLine !== null) {
      if (separatorReported) continue;

      if (ANSWER_PREFIX_PATTERN.test(line.text)) {
        blockDiagnostics.push(
          diagnostic('syntax', 'DUPLICATE_ANSWER', line.number, 'Question contains more than one answer line')
        );
        continue;
      }
      if (!separatorReported) {
        blockDiagnostics.push(
          diagnostic(
            'syntax',
            'QUESTION_SEPARATOR_REQUIRED',
            line.number,
            'A blank line must separate consecutive Aiken questions'
          )
        );
        separatorReported = true;
      }
      continue;
    }

    const exactOption = OPTION_PATTERN.exec(line.text);
    if (exactOption) {
      const label = optionLabel(exactOption[1]!);
      if (label === null) continue;

      if (options.has(label)) {
        blockDiagnostics.push(
          diagnostic('syntax', 'DUPLICATE_OPTION', line.number, `Option ${label} is declared more than once`)
        );
        continue;
      }

      const expectedLabel = OPTION_LABELS[options.size];
      if (expectedLabel !== label) {
        blockDiagnostics.push(
          diagnostic(
            'syntax',
            'OPTION_OUT_OF_ORDER',
            line.number,
            `Expected option ${expectedLabel ?? 'ANSWER'}, found option ${label}`
          )
        );
      }
      options.set(label, { label, text: exactOption[2]!, line: line.number });
      continue;
    }

    const prefixedOption = OPTION_PREFIX_PATTERN.exec(line.text);
    if (prefixedOption) {
      const label = optionLabel(prefixedOption[1]!);
      if (label === null) {
        blockDiagnostics.push(
          diagnostic(
            'unsupported',
            'UNSUPPORTED_OPTION_LABEL',
            line.number,
            `Option label "${prefixedOption[1]}" is outside the supported A-D option set`
          )
        );
      } else {
        blockDiagnostics.push(
          diagnostic(
            'syntax',
            'MALFORMED_OPTION',
            line.number,
            `Option ${label} must contain non-empty text after "${label}. "`
          )
        );
      }
      continue;
    }

    if (UNSUPPORTED_OPTION_MARKER.test(line.text)) {
      blockDiagnostics.push(
        diagnostic(
          'unsupported',
          'UNSUPPORTED_OPTION_MARKER',
          line.number,
          'Options must use the exact A.-D. marker form'
        )
      );
      continue;
    }

    const exactAnswer = ANSWER_PATTERN.exec(line.text);
    if (exactAnswer) {
      const label = optionLabel(exactAnswer[1]!);
      if (label !== null) {
        answer = label;
        answerLine = line.number;
      }
      continue;
    }

    const answerPrefix = ANSWER_PREFIX_PATTERN.exec(line.text);
    if (answerPrefix) {
      blockDiagnostics.push(unsupportedAnswerDiagnostic(line, answerPrefix[1]!));
      answerLine = line.number;
      continue;
    }

    blockDiagnostics.push(
      options.size === 0
        ? diagnostic(
            'unsupported',
            'UNSUPPORTED_MULTILINE_QUESTION',
            line.number,
            'Question text must occupy one line in the supported Aiken profile'
          )
        : diagnostic(
            'unsupported',
            'UNSUPPORTED_OPTION_CONTINUATION',
            line.number,
            'Option text must occupy the same line as its A.-D. marker'
          )
    );
  }

  const missingLine = answerLine ?? block.at(-1)!.number;
  for (const label of OPTION_LABELS) {
    if (!options.has(label)) {
      blockDiagnostics.push(diagnostic('syntax', 'MISSING_OPTION', missingLine, `Question is missing option ${label}`));
    }
  }
  if (answerLine === null) {
    blockDiagnostics.push(
      diagnostic('syntax', 'MISSING_ANSWER', block.at(-1)!.number, 'Question is missing an ANSWER line')
    );
  }

  diagnostics.push(...blockDiagnostics);
  if (blockDiagnostics.length > 0 || answer === null || answerLine === null) return null;

  return {
    prompt: promptLine.text,
    startLine: promptLine.number,
    endLine: block.at(-1)!.number,
    options: OPTION_LABELS.map((label) => options.get(label)!),
    answer,
    answerLine
  };
}

function sourceSpan(startLine: number, endLine = startLine): ExamImportSourceSpan {
  return {
    start: { blockIndex: startLine - 1, runIndex: 0 },
    end: { blockIndex: endLine - 1, runIndex: 0 },
    pageStart: null,
    pageEnd: null
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

function paragraphHtml(value: string): string {
  return `<p>${escapeHtml(value)}</p>`;
}

function buildDraft(questions: ParsedQuestion[], metadata: AikenParseMetadata): ExamImportDraft {
  const fieldStates: ExamImportFieldState[] = [];
  const draftQuestions: Extract<ExamImportDraft['sections'][number]['questions'][number], { kind: 'choice' }>[] =
    questions.map((question, questionIndex) => {
      const questionId = `aiken-question-${questionIndex + 1}`;
      const provenance = [sourceSpan(question.startLine, question.endLine)];
      const options = question.options.map((option, optionIndex) => {
        const optionId = `${questionId}-option-${option.label.toLowerCase()}`;
        fieldStates.push({
          target: { kind: 'option_field', questionId, optionId, field: 'html' },
          confidence: 'high',
          origin: 'deterministic',
          provenance: [sourceSpan(option.line)]
        });

        return {
          id: optionId,
          sourceLabel: option.label,
          html: paragraphHtml(option.text),
          order: optionIndex
        };
      });
      const correctOptionId = `${questionId}-option-${question.answer.toLowerCase()}`;
      const candidateId = `${questionId}-answer`;
      const answerProvenance = [sourceSpan(question.answerLine)];

      fieldStates.push(
        {
          target: { kind: 'question_field', questionId, field: 'kind' },
          confidence: 'high',
          origin: 'deterministic',
          provenance
        },
        {
          target: { kind: 'question_field', questionId, field: 'promptHtml' },
          confidence: 'high',
          origin: 'deterministic',
          provenance: [sourceSpan(question.startLine)]
        },
        {
          target: { kind: 'question_field', questionId, field: 'answerKey' },
          confidence: 'medium',
          origin: 'deterministic',
          provenance: answerProvenance
        }
      );

      return {
        id: questionId,
        kind: 'choice',
        order: questionIndex,
        sourceNumber: null,
        promptHtml: paragraphHtml(question.prompt),
        points: null,
        cognitiveLevel: null,
        passageId: null,
        cardinality: 'single',
        options,
        answerCandidates: [
          {
            id: candidateId,
            kind: 'choice',
            correctOptionIds: [correctOptionId],
            source: 'explicit_line',
            provenance: answerProvenance
          }
        ],
        answerKey: {
          kind: 'choice',
          correctOptionIds: [correctOptionId],
          agreement: 'single_source',
          selectedCandidateIds: [candidateId],
          conflictingCandidateIds: []
        },
        confidence: 'medium',
        review: 'clean',
        provenance
      };
    });

  return {
    schemaVersion: EXAM_IMPORT_SCHEMA_VERSION,
    source: {
      assetId: metadata.assetId,
      fileName: metadata.fileName,
      mimeType: 'text/plain; charset=utf-8',
      extractor: 'aiken'
    },
    title: metadata.title,
    fieldStates,
    sharedContents: [],
    sections: [{ id: 'aiken-section-1', title: 'Questions', order: 0, questions: draftQuestions }],
    diagnostics: []
  };
}

export function parseAiken(input: string, metadata: AikenParseMetadata): ExamImportDraft {
  if (input.length > MAX_AIKEN_INPUT_CHARACTERS) {
    throw new AikenParseError([
      diagnostic('unsupported', 'INPUT_TOO_LARGE', 1, `Aiken input exceeds ${MAX_AIKEN_INPUT_CHARACTERS} characters`)
    ]);
  }
  const lines = sourceLines(input);
  const diagnostics: AikenDiagnostic[] = [];

  for (const line of lines) {
    if (line.text.includes('\uFFFD')) {
      diagnostics.push(
        diagnostic(
          'syntax',
          'INVALID_UTF8_TEXT',
          line.number,
          'Input contains a Unicode replacement character from invalid UTF-8 decoding'
        )
      );
    }
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(line.text)) {
      diagnostics.push(
        diagnostic(
          'unsupported',
          'UNSUPPORTED_CONTROL_CHARACTER',
          line.number,
          'Control characters are outside the supported Aiken profile'
        )
      );
    }
  }

  const blocks = questionBlocks(lines);
  if (blocks.length === 0) {
    diagnostics.push(diagnostic('syntax', 'EMPTY_INPUT', 1, 'Aiken input contains no questions'));
  }

  const parsedQuestions = blocks.flatMap((block) => {
    const question = parseQuestionBlock(block, diagnostics);

    return question === null ? [] : [question];
  });
  if (parsedQuestions.length > MAX_EXAM_IMPORT_QUESTIONS_PER_SECTION) {
    diagnostics.push(
      diagnostic(
        'unsupported',
        'TOO_MANY_QUESTIONS',
        blocks[MAX_EXAM_IMPORT_QUESTIONS_PER_SECTION]?.[0]?.number ?? 1,
        `Aiken imports support at most ${MAX_EXAM_IMPORT_QUESTIONS_PER_SECTION} questions`
      )
    );
  }

  if (diagnostics.length > 0) throw new AikenParseError(sortDiagnostics(diagnostics));

  const draft = buildDraft(parsedQuestions, metadata);
  const parsedDraft = examImportDraftSchema.safeParse(draft);
  if (!parsedDraft.success) {
    const issue = parsedDraft.error.issues[0];
    const path = issue?.path.map(String).join('.') || 'draft';
    throw new AikenParseError([
      diagnostic('syntax', 'DRAFT_VALIDATION_FAILED', 1, `${path}: ${issue?.message ?? 'Generated draft is invalid'}`)
    ]);
  }

  return parsedDraft.data;
}
