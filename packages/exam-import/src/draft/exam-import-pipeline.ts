import type { SourceRun } from '../source-run';
import type { ExamImportDraft } from './exam-import-draft';
import { harvestExamImportAnswerCandidates } from './exam-import-answer-harvesting';
import { reconcileExamImportDraftAnswers } from './exam-import-reconciliation';
import { segmentExamImportRuns } from './exam-import-segmentation';
import {
  validateExamImportDraft,
  type ExamImportValidationContext,
  type ExamImportValidationResult
} from './exam-import-validation';

export function createExamImportDraftFromRuns(runs: SourceRun[], source: ExamImportDraft['source']): ExamImportDraft {
  const segmented = segmentExamImportRuns(runs, source);
  const harvested = harvestExamImportAnswerCandidates(segmented, runs);

  return reconcileExamImportDraftAnswers(harvested);
}

export function createValidatedExamImportDraftFromRuns(
  runs: SourceRun[],
  source: ExamImportDraft['source'],
  validationContext: ExamImportValidationContext
): ExamImportValidationResult {
  const draft = createExamImportDraftFromRuns(runs, source);

  return validateExamImportDraft(draft, validationContext);
}
