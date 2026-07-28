import type { AssessmentDeliveryDefinition } from '@cio/question-types';
import type { ExamImportDiagnostic, ExamImportDraft, ExamImportQuestion } from '$features/course/utils/types';

export type ExamImportQuestionView = {
  question: ExamImportQuestion;
  sectionId: string;
  sectionTitle: string;
  documentIndex: number;
  findings: ExamImportDiagnostic[];
};

const confidenceRank = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  teacher_confirmed: 4
} as const;

export function getExamImportFailureDescriptionKey(failure: unknown): string {
  if (typeof failure !== 'object' || failure === null || !('code' in failure) || typeof failure.code !== 'string') {
    return 'exam_import.status.failed_description';
  }

  switch (failure.code) {
    case 'EXAM_IMPORT_SCAN_AI_DISABLED':
    case 'EXAM_IMPORT_SCAN_VISION_DISABLED':
      return 'exam_import.status.scan_ai_disabled';
    case 'EXAM_IMPORT_SCAN_AI_CONSENT_REQUIRED':
      return 'exam_import.status.scan_ai_consent_required';
    case 'EXAM_IMPORT_SCAN_VISION_CONSENT_REQUIRED':
      return 'exam_import.status.scan_vision_consent_required';
    case 'EXAM_IMPORT_SCAN_VISION_MODEL_UNAVAILABLE':
      return 'exam_import.status.scan_model_unavailable';
    case 'EXAM_IMPORT_SCAN_AI_CAPACITY_UNAVAILABLE':
    case 'EXAM_IMPORT_SCAN_AI_GATEWAY_UNAVAILABLE':
    case 'EXAM_IMPORT_SCAN_MODEL_CHANGED':
    case 'EXAM_IMPORT_SCAN_TRANSCRIPTION_INVALID':
      return 'exam_import.status.scan_service_unavailable';
    case 'EXAM_IMPORT_PDF_SCAN_INVALID':
    case 'EXAM_IMPORT_SCAN_CHECKPOINT_INVALID':
      return 'exam_import.status.scan_invalid';
    default:
      return 'exam_import.status.failed_description';
  }
}

export function parseExamImportNumericAnswer(
  valueInput: string,
  toleranceInput: string
): { kind: 'numeric'; value: number; tolerance: number | null } | null {
  if (valueInput.trim() === '') return null;

  const value = Number(valueInput);
  const tolerance = toleranceInput.trim() === '' ? null : Number(toleranceInput);
  if (!Number.isFinite(value) || (tolerance !== null && (!Number.isFinite(tolerance) || tolerance < 0))) {
    return null;
  }

  return { kind: 'numeric', value, tolerance };
}

export function getExamImportQuestionViews(
  draft: ExamImportDraft,
  findings: readonly ExamImportDiagnostic[],
  order: 'review' | 'document'
): ExamImportQuestionView[] {
  let documentIndex = 0;
  const views = [...draft.sections]
    .sort((left, right) => left.order - right.order)
    .flatMap((section) =>
      [...section.questions]
        .sort((left, right) => left.order - right.order)
        .map((question) => ({
          question,
          sectionId: section.id,
          sectionTitle: section.title,
          documentIndex: documentIndex++,
          findings: findings.filter((finding) => finding.questionId === question.id)
        }))
    );

  if (order === 'document') return views;

  return views.sort((left, right) => {
    const blockingDifference =
      Number(right.findings.some((finding) => finding.blocking)) -
      Number(left.findings.some((finding) => finding.blocking));
    if (blockingDifference !== 0) return blockingDifference;

    const reviewDifference = Number(right.question.review !== 'clean') - Number(left.question.review !== 'clean');
    if (reviewDifference !== 0) return reviewDifference;

    const confidenceDifference = confidenceRank[left.question.confidence] - confidenceRank[right.question.confidence];
    return confidenceDifference || left.documentIndex - right.documentIndex;
  });
}

export function getQuestionSourceExcerpt(question: ExamImportQuestion): string {
  const spans = question.provenance;
  const first = spans[0];
  const last = spans.at(-1);
  if (!first || !last) return '';

  const blockRange =
    first.start.blockIndex === last.end.blockIndex
      ? `#${first.start.blockIndex + 1}`
      : `#${first.start.blockIndex + 1}-${last.end.blockIndex + 1}`;
  if (first.pageStart === null || last.pageEnd === null) return blockRange;

  const pageRange =
    first.pageStart === last.pageEnd ? `${first.pageStart + 1}` : `${first.pageStart + 1}-${last.pageEnd + 1}`;
  return `${pageRange} · ${blockRange}`;
}

export function toExamImportDeliveryDefinition(question: ExamImportQuestion): AssessmentDeliveryDefinition | null {
  if (question.kind === 'unresolved') return null;

  const base = {
    prompt: { format: 'html' as const, html: question.promptHtml },
    required: true,
    maxScore: question.points ?? 1
  };
  const interaction = (() => {
    switch (question.kind) {
      case 'choice':
        return {
          kind: 'choice' as const,
          ...base,
          config: {
            cardinality: question.cardinality,
            presentation: 'list' as const,
            options: [...question.options]
              .sort((left, right) => left.order - right.order)
              .map((option) => ({ id: option.id, html: option.html }))
          }
        };
      case 'true_false_group':
        return {
          kind: 'true_false_group' as const,
          ...base,
          config: {
            statements: [...question.statements]
              .sort((left, right) => left.order - right.order)
              .map((statement) => ({ id: statement.id, html: statement.html })),
            scoring: question.scoring
          }
        };
      case 'short_answer':
        return {
          kind: 'text' as const,
          ...base,
          config: { format: 'plain' as const }
        };
      case 'numeric':
        return {
          kind: 'numeric' as const,
          ...base,
          config: { tolerance: question.answerKey?.tolerance ?? 0 }
        };
      case 'essay':
        return {
          kind: 'text' as const,
          ...base,
          config: { format: 'rich' as const }
        };
    }
  })();

  return {
    schemaVersion: 1,
    blocks: [{ id: question.id, kind: 'interaction', interaction }]
  };
}
