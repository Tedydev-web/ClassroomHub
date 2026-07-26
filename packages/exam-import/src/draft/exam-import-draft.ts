import {
  ASSESSMENT_ID_PATTERN,
  MAX_ASSESSMENT_ID_LENGTH,
  MAX_AUTHORED_HTML_LENGTH,
  MAX_INTERACTION_MAX_SCORE,
  MAX_INTERACTION_OPTIONS
} from '@cio/question-types';
import * as z from 'zod';

export const EXAM_IMPORT_SCHEMA_VERSION = 1;
export const MAX_EXAM_IMPORT_SECTIONS = 100;
export const MAX_EXAM_IMPORT_QUESTIONS_PER_SECTION = 500;
export const MAX_EXAM_IMPORT_TOTAL_QUESTIONS = 5_000;
export const MAX_EXAM_IMPORT_SHARED_CONTENTS = 500;
export const MAX_EXAM_IMPORT_DIAGNOSTICS = MAX_EXAM_IMPORT_TOTAL_QUESTIONS * 4;
export const MAX_EXAM_IMPORT_PROVENANCE_SPANS = 20;
export const MAX_EXAM_IMPORT_FIELD_STATES = 50_000;

export const EXAM_IMPORT_PUBLISHABLE_QUESTION_KINDS = [
  'choice',
  'true_false_group',
  'short_answer',
  'numeric',
  'essay'
] as const;

export type ExamImportPublishableQuestionKind = (typeof EXAM_IMPORT_PUBLISHABLE_QUESTION_KINDS)[number];

const idSchema = z.string().min(1).max(MAX_ASSESSMENT_ID_LENGTH).regex(ASSESSMENT_ID_PATTERN);
const htmlSchema = z.string().min(1).max(MAX_AUTHORED_HTML_LENGTH);
const nullablePointsSchema = z.number().min(0).max(MAX_INTERACTION_MAX_SCORE).multipleOf(0.01).nullable();

const sourceLocationSchema = z.strictObject({
  blockIndex: z.number().int().min(0),
  runIndex: z.number().int().min(0)
});

export const examImportSourceSpanSchema = z
  .strictObject({
    start: sourceLocationSchema,
    end: sourceLocationSchema,
    pageStart: z.number().int().min(0).nullable(),
    pageEnd: z.number().int().min(0).nullable()
  })
  .superRefine((span, context) => {
    const startsAfterEnd =
      span.start.blockIndex > span.end.blockIndex ||
      (span.start.blockIndex === span.end.blockIndex && span.start.runIndex > span.end.runIndex);
    if (startsAfterEnd) {
      context.addIssue({
        code: 'custom',
        path: ['end'],
        message: 'Source span end must not precede its start'
      });
    }

    if ((span.pageStart === null) !== (span.pageEnd === null)) {
      context.addIssue({
        code: 'custom',
        path: ['pageEnd'],
        message: 'Source span page bounds must both be present or both be null'
      });
    } else if (span.pageStart !== null && span.pageEnd !== null && span.pageStart > span.pageEnd) {
      context.addIssue({
        code: 'custom',
        path: ['pageEnd'],
        message: 'Source page end must not precede its start'
      });
    }
  });

export type ExamImportSourceSpan = z.infer<typeof examImportSourceSpanSchema>;

const provenanceSchema = z.array(examImportSourceSpanSchema).min(1).max(MAX_EXAM_IMPORT_PROVENANCE_SPANS);

const draftFieldTargetSchema = z.strictObject({
  kind: z.literal('draft_field'),
  field: z.literal('title')
});

const sharedContentFieldTargetSchema = z.strictObject({
  kind: z.literal('shared_content_field'),
  contentId: idSchema,
  field: z.literal('html')
});

const sectionFieldTargetSchema = z.strictObject({
  kind: z.literal('section_field'),
  sectionId: idSchema,
  field: z.enum(['title', 'order'])
});

const questionFieldTargetSchema = z.strictObject({
  kind: z.literal('question_field'),
  questionId: idSchema,
  field: z.enum([
    'kind',
    'order',
    'promptHtml',
    'points',
    'cognitiveLevel',
    'answerKey',
    'passageId',
    'cardinality',
    'scoring'
  ])
});

const optionFieldTargetSchema = z.strictObject({
  kind: z.literal('option_field'),
  questionId: idSchema,
  optionId: idSchema,
  field: z.enum(['sourceLabel', 'html', 'order'])
});

const statementFieldTargetSchema = z.strictObject({
  kind: z.literal('statement_field'),
  questionId: idSchema,
  statementId: idSchema,
  field: z.enum(['sourceLabel', 'html', 'correctValue', 'order'])
});

export const examImportFieldTargetSchema = z.discriminatedUnion('kind', [
  draftFieldTargetSchema,
  sharedContentFieldTargetSchema,
  sectionFieldTargetSchema,
  questionFieldTargetSchema,
  optionFieldTargetSchema,
  statementFieldTargetSchema
]);

export type ExamImportFieldTarget = z.infer<typeof examImportFieldTargetSchema>;

export const examImportConfidenceSchema = z.enum(['high', 'medium', 'low', 'none', 'teacher_confirmed']);
export type ExamImportConfidence = z.infer<typeof examImportConfidenceSchema>;

const fieldStateSchema = z.strictObject({
  target: examImportFieldTargetSchema,
  confidence: examImportConfidenceSchema,
  origin: z.enum(['deterministic', 'ai', 'teacher']),
  provenance: provenanceSchema
});

export type ExamImportFieldState = z.infer<typeof fieldStateSchema>;

export const examImportAnswerSourceSchema = z.enum([
  'answer_table',
  'emphasis',
  'key_string',
  'explicit_line',
  'ai',
  'teacher'
]);

export type ExamImportAnswerSource = z.infer<typeof examImportAnswerSourceSchema>;

const answerCandidateBase = {
  id: idSchema,
  source: examImportAnswerSourceSchema,
  provenance: provenanceSchema
};

const choiceAnswerCandidateSchema = z.strictObject({
  ...answerCandidateBase,
  kind: z.literal('choice'),
  correctOptionIds: z.array(idSchema).min(1).max(MAX_INTERACTION_OPTIONS)
});

const trueFalseGroupAnswerCandidateSchema = z.strictObject({
  ...answerCandidateBase,
  kind: z.literal('true_false_group'),
  answers: z
    .array(z.strictObject({ statementId: idSchema, correctValue: z.boolean() }))
    .min(1)
    .max(MAX_INTERACTION_OPTIONS)
});

const shortAnswerCandidateSchema = z.strictObject({
  ...answerCandidateBase,
  kind: z.literal('short_answer'),
  acceptedAnswers: z.array(z.string().trim().min(1).max(MAX_AUTHORED_HTML_LENGTH)).min(1).max(MAX_INTERACTION_OPTIONS)
});

const numericAnswerCandidateSchema = z.strictObject({
  ...answerCandidateBase,
  kind: z.literal('numeric'),
  value: z.number().finite(),
  tolerance: z.number().finite().min(0).nullable()
});

const answerKeyBase = {
  agreement: z.enum(['unanimous', 'single_source', 'conflict']),
  selectedCandidateIds: z.array(idSchema).min(1).max(MAX_INTERACTION_OPTIONS),
  conflictingCandidateIds: z.array(idSchema).max(MAX_INTERACTION_OPTIONS)
};

const choiceAnswerKeySchema = z.strictObject({
  ...answerKeyBase,
  kind: z.literal('choice'),
  correctOptionIds: z.array(idSchema).min(1).max(MAX_INTERACTION_OPTIONS)
});

const trueFalseGroupAnswerKeySchema = z.strictObject({
  ...answerKeyBase,
  kind: z.literal('true_false_group'),
  answers: z
    .array(z.strictObject({ statementId: idSchema, correctValue: z.boolean() }))
    .min(2)
    .max(MAX_INTERACTION_OPTIONS)
});

const shortAnswerKeySchema = z.strictObject({
  ...answerKeyBase,
  kind: z.literal('short_answer'),
  acceptedAnswers: z.array(z.string().trim().min(1).max(MAX_AUTHORED_HTML_LENGTH)).min(1).max(MAX_INTERACTION_OPTIONS)
});

const numericAnswerKeySchema = z.strictObject({
  ...answerKeyBase,
  kind: z.literal('numeric'),
  value: z.number().finite(),
  tolerance: z.number().finite().min(0).nullable()
});

const commonQuestionShape = {
  id: idSchema,
  order: z.number().int().min(0),
  sourceNumber: z.string().trim().min(1).max(64).nullable(),
  promptHtml: htmlSchema,
  points: nullablePointsSchema,
  cognitiveLevel: z.enum(['NB', 'TH', 'VD', 'VDC']).nullable(),
  passageId: idSchema.nullable(),
  confidence: examImportConfidenceSchema,
  review: z.enum(['clean', 'needs_attention', 'unresolved']),
  provenance: provenanceSchema
};

const optionSchema = z.strictObject({
  id: idSchema,
  sourceLabel: z.string().trim().min(1).max(16),
  html: htmlSchema,
  order: z.number().int().min(0)
});

const choiceQuestionSchema = z.strictObject({
  ...commonQuestionShape,
  kind: z.literal('choice'),
  cardinality: z.enum(['single', 'multiple']),
  options: z.array(optionSchema).min(2).max(MAX_INTERACTION_OPTIONS),
  answerCandidates: z.array(choiceAnswerCandidateSchema).max(MAX_INTERACTION_OPTIONS),
  answerKey: choiceAnswerKeySchema.nullable()
});

const trueFalseScoringSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('tiered'),
    tiers: z
      .array(z.number().min(0).max(1))
      .min(3)
      .max(MAX_INTERACTION_OPTIONS + 1)
  }),
  z.strictObject({ mode: z.literal('proportional') }),
  z.strictObject({ mode: z.literal('all_or_nothing') })
]);

const trueFalseStatementSchema = z.strictObject({
  id: idSchema,
  sourceLabel: z.string().trim().min(1).max(16),
  html: htmlSchema,
  order: z.number().int().min(0)
});

const trueFalseGroupQuestionSchema = z.strictObject({
  ...commonQuestionShape,
  kind: z.literal('true_false_group'),
  statements: z.array(trueFalseStatementSchema).min(2).max(MAX_INTERACTION_OPTIONS),
  scoring: trueFalseScoringSchema,
  answerCandidates: z.array(trueFalseGroupAnswerCandidateSchema).max(MAX_INTERACTION_OPTIONS),
  answerKey: trueFalseGroupAnswerKeySchema.nullable()
});

const shortAnswerQuestionSchema = z.strictObject({
  ...commonQuestionShape,
  kind: z.literal('short_answer'),
  answerCandidates: z.array(shortAnswerCandidateSchema).max(MAX_INTERACTION_OPTIONS),
  answerKey: shortAnswerKeySchema.nullable()
});

const numericQuestionSchema = z.strictObject({
  ...commonQuestionShape,
  kind: z.literal('numeric'),
  answerCandidates: z.array(numericAnswerCandidateSchema).max(MAX_INTERACTION_OPTIONS),
  answerKey: numericAnswerKeySchema.nullable()
});

const essayQuestionSchema = z.strictObject({
  ...commonQuestionShape,
  kind: z.literal('essay'),
  answerCandidates: z.tuple([]),
  answerKey: z.null()
});

const unresolvedQuestionSchema = z.strictObject({
  ...commonQuestionShape,
  kind: z.literal('unresolved'),
  rawHtml: htmlSchema,
  answerCandidates: z.tuple([]),
  answerKey: z.null(),
  confidence: z.literal('none'),
  review: z.literal('unresolved')
});

export const examImportQuestionSchema = z.discriminatedUnion('kind', [
  choiceQuestionSchema,
  trueFalseGroupQuestionSchema,
  shortAnswerQuestionSchema,
  numericQuestionSchema,
  essayQuestionSchema,
  unresolvedQuestionSchema
]);

export type ExamImportQuestion = z.infer<typeof examImportQuestionSchema>;

const sharedContentSchema = z.strictObject({
  id: idSchema,
  kind: z.enum(['passage', 'table_content']),
  html: htmlSchema,
  provenance: provenanceSchema
});

const sectionSchema = z.strictObject({
  id: idSchema,
  title: z.string().trim().min(1).max(500),
  order: z.number().int().min(0),
  questions: z.array(examImportQuestionSchema).max(MAX_EXAM_IMPORT_QUESTIONS_PER_SECTION)
});

export const examImportDiagnosticSchema = z
  .strictObject({
    tier: z.enum(['structural', 'semantic', 'assisted']),
    severity: z.enum(['info', 'warning', 'error']),
    blocking: z.boolean(),
    code: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*$/)
      .max(100),
    message: z.string().min(1).max(2_000),
    messageKey: z
      .string()
      .regex(/^[a-z0-9_.]+$/)
      .max(200),
    questionId: idSchema.nullable(),
    target: examImportFieldTargetSchema.nullable(),
    provenance: z.array(examImportSourceSpanSchema).max(MAX_EXAM_IMPORT_PROVENANCE_SPANS)
  })
  .superRefine((diagnostic, context) => {
    if (diagnostic.tier === 'assisted' && diagnostic.blocking) {
      context.addIssue({
        code: 'custom',
        path: ['blocking'],
        message: 'Assisted diagnostics are advisory and cannot block publishing'
      });
    }
    if (diagnostic.blocking && diagnostic.severity !== 'error') {
      context.addIssue({
        code: 'custom',
        path: ['severity'],
        message: 'Blocking diagnostics must have error severity'
      });
    }
  });

export type ExamImportDiagnostic = z.infer<typeof examImportDiagnosticSchema>;

export function boundExamImportDiagnostics(diagnostics: ExamImportDiagnostic[]): ExamImportDiagnostic[] {
  if (diagnostics.length <= MAX_EXAM_IMPORT_DIAGNOSTICS) return diagnostics;

  return [
    ...diagnostics.slice(0, MAX_EXAM_IMPORT_DIAGNOSTICS - 1),
    {
      tier: 'semantic',
      severity: 'error',
      blocking: true,
      code: 'DIAGNOSTICS_TRUNCATED',
      message: 'Additional findings were omitted after the diagnostic limit was reached',
      messageKey: 'exam_import.diagnostics.diagnostics_truncated',
      questionId: null,
      target: null,
      provenance: diagnostics[0]?.provenance ?? []
    }
  ];
}

export const examImportDraftSchema = z.strictObject({
  schemaVersion: z.literal(EXAM_IMPORT_SCHEMA_VERSION),
  source: z.strictObject({
    assetId: z.string().min(1).max(200),
    fileName: z.string().min(1).max(500),
    mimeType: z.string().min(1).max(200),
    extractor: z.enum(['docx', 'pdf', 'gift', 'aiken'])
  }),
  title: z.string().trim().min(1).max(500),
  fieldStates: z.array(fieldStateSchema).max(MAX_EXAM_IMPORT_FIELD_STATES),
  sharedContents: z.array(sharedContentSchema).max(MAX_EXAM_IMPORT_SHARED_CONTENTS),
  sections: z.array(sectionSchema).min(1).max(MAX_EXAM_IMPORT_SECTIONS),
  diagnostics: z.array(examImportDiagnosticSchema).max(MAX_EXAM_IMPORT_DIAGNOSTICS)
});

export type ExamImportDraft = z.infer<typeof examImportDraftSchema>;
