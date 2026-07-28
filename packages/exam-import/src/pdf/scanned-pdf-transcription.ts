import * as z from 'zod';

import { emptyFormatting, sourceRunStreamSchema, type SourceRun } from '../source-run';
import { examImportDraftSchema, type ExamImportDraft, type ExamImportQuestion } from '../draft/exam-import-draft';
import { SCANNED_PDF_RASTER_LIMITS } from './read-scanned-pdf-page-rasters';

export const MAX_SCANNED_PDF_TRANSCRIPTION_LINES_PER_PAGE = 300;
export const MAX_SCANNED_PDF_TRANSCRIPTION_LINE_LENGTH = 2_000;

export const scannedPdfPageTranscriptionSchema = z.strictObject({
  pageIndex: z
    .number()
    .int()
    .min(0)
    .max(SCANNED_PDF_RASTER_LIMITS.pages - 1),
  lines: z
    .array(
      z
        .string()
        .min(1)
        .max(MAX_SCANNED_PDF_TRANSCRIPTION_LINE_LENGTH)
        .refine((line) => line.trim().length > 0)
    )
    .min(1)
    .max(MAX_SCANNED_PDF_TRANSCRIPTION_LINES_PER_PAGE)
});

export type ScannedPdfPageTranscription = z.infer<typeof scannedPdfPageTranscriptionSchema>;

const scannedPdfTranscriptionsSchema = z
  .array(scannedPdfPageTranscriptionSchema)
  .min(1)
  .max(SCANNED_PDF_RASTER_LIMITS.pages)
  .superRefine((pages, context) => {
    pages.forEach((page, index) => {
      if (page.pageIndex !== index) {
        context.addIssue({
          code: 'custom',
          path: [index, 'pageIndex'],
          message: 'Scanned PDF page transcriptions must be contiguous and ordered'
        });
      }
    });
  });

export function scannedPdfTranscriptionsToSourceRuns(value: unknown): SourceRun[] {
  const pages = scannedPdfTranscriptionsSchema.parse(value);
  let blockIndex = 0;
  const runs: SourceRun[] = [];

  for (const page of pages) {
    for (const line of page.lines) {
      runs.push({
        text: line,
        formatting: emptyFormatting(),
        block: {
          kind: 'paragraph',
          index: blockIndex,
          listNumber: null,
          tableRef: null
        },
        math: null,
        image: null,
        location: {
          blockIndex,
          runIndex: 0
        }
      });
      blockIndex += 1;
    }
  }

  return sourceRunStreamSchema.parse(runs);
}

function markQuestionAsAiDerived(question: ExamImportQuestion): ExamImportQuestion {
  switch (question.kind) {
    case 'choice':
      return {
        ...question,
        answerCandidates: question.answerCandidates.map((candidate) =>
          candidate.source === 'teacher' ? candidate : { ...candidate, source: 'ai' as const }
        ),
        confidence: 'low',
        review: question.answerKey === null ? 'unresolved' : 'needs_attention'
      };
    case 'true_false_group':
      return {
        ...question,
        answerCandidates: question.answerCandidates.map((candidate) =>
          candidate.source === 'teacher' ? candidate : { ...candidate, source: 'ai' as const }
        ),
        confidence: 'low',
        review: question.answerKey === null ? 'unresolved' : 'needs_attention'
      };
    case 'short_answer':
      return {
        ...question,
        answerCandidates: question.answerCandidates.map((candidate) =>
          candidate.source === 'teacher' ? candidate : { ...candidate, source: 'ai' as const }
        ),
        confidence: 'low',
        review: question.answerKey === null ? 'unresolved' : 'needs_attention'
      };
    case 'numeric':
      return {
        ...question,
        answerCandidates: question.answerCandidates.map((candidate) =>
          candidate.source === 'teacher' ? candidate : { ...candidate, source: 'ai' as const }
        ),
        confidence: 'low',
        review: question.answerKey === null ? 'unresolved' : 'needs_attention'
      };
    case 'essay':
      return { ...question, confidence: 'low', review: 'needs_attention' };
    case 'unresolved':
      return question;
  }
}

export function markExamImportDraftAsAiDerived(value: unknown): ExamImportDraft {
  const draft = examImportDraftSchema.parse(value);
  const fieldStates = draft.fieldStates.map((fieldState) =>
    fieldState.origin === 'teacher'
      ? fieldState
      : {
          ...fieldState,
          confidence: 'low' as const,
          origin: 'ai' as const
        }
  );
  const sections = draft.sections.map((section) => ({
    ...section,
    questions: section.questions.map(markQuestionAsAiDerived)
  }));

  return examImportDraftSchema.parse({
    ...draft,
    fieldStates,
    sections
  });
}
