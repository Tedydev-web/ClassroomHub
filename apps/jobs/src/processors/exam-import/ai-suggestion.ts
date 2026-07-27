import { db } from '@cio/db/drizzle';
import {
  getExamImportById,
  getExamImportDraft,
  lockExamImportById,
  recordExamImportAiRegion,
  replaceExamImportDraft,
  updateExamImportDraftSummary,
  type ExamImportScope
} from '@cio/db/queries/exam-import';
import { applyExamImportAiRegionResponse, collectExamImportAiRegions, validateExamImportDraft } from '@cio/exam-import';
import { recordTokenUsage } from '@cio/core/services/agent/usage';
import { ZExamImportAiSuggestionPayload } from '@cio/jobs/payloads/exam-import';
import { sanitizeHtml } from '@cio/core/utils/sanitize-html';

import { log } from '../../utils/logger';
import { requestNextExamImportAiRegion } from './ai-region';

type SuggestionResult =
  | { status: 'applied' }
  | { status: 'stale' | 'not_available' | 'not_suggestable' | 'rejected' | 'unavailable' | 'waiting' };

function validationContext() {
  return {
    enabledQuestionKinds: new Set(['choice', 'true_false_group', 'short_answer', 'numeric', 'essay'] as const),
    sanitizeHtml
  };
}

function draftSummary(draft: NonNullable<ReturnType<typeof validateExamImportDraft>['draft']>, warningCount: number) {
  const questions = draft.sections.flatMap((section) => section.questions);

  return {
    sectionCount: draft.sections.length,
    questionCount: questions.length,
    reviewRequiredCount: questions.filter((question) => question.review !== 'clean').length,
    blockingIssueCount: validateExamImportDraft(draft, validationContext()).findings.filter(
      (finding) => finding.blocking
    ).length,
    warningCount
  };
}

export async function processExamImportAiSuggestion(rawPayload: unknown): Promise<SuggestionResult> {
  const payload = ZExamImportAiSuggestionPayload.parse(rawPayload);
  const scope: ExamImportScope = {
    importId: payload.importId,
    organizationId: payload.organizationId,
    courseId: payload.courseId
  };
  let expectedDraftUpdatedAt = payload.expectedDraftUpdatedAt;
  let appliedCount = 0;

  for (const questionId of payload.questionIds) {
    const examImport = await getExamImportById(scope);
    if (!examImport || examImport.status !== 'draft_ready')
      return { status: appliedCount > 0 ? 'applied' : 'not_available' };

    const draftRecord = await getExamImportDraft(scope);
    if (!draftRecord || draftRecord.updatedAt !== expectedDraftUpdatedAt)
      return { status: appliedCount > 0 ? 'applied' : 'stale' };

    const validation = validateExamImportDraft(draftRecord.draft, validationContext());
    if (!validation.draft) return { status: appliedCount > 0 ? 'applied' : 'not_available' };

    const region = collectExamImportAiRegions(validation.draft).find(
      (candidate) => candidate.questionId === questionId
    );
    if (!region) continue;

    const aiCall = await requestNextExamImportAiRegion({
      draft: validation.draft,
      organizationId: scope.organizationId,
      auditedQuestionIds: new Set(),
      questionId
    });
    if (aiCall.kind === 'disabled') return { status: appliedCount > 0 ? 'applied' : 'unavailable' };
    if (aiCall.kind === 'waiting') return { status: appliedCount > 0 ? 'applied' : 'waiting' };

    if (aiCall.promptTokens > 0 || aiCall.completionTokens > 0) {
      await recordTokenUsage(
        scope.organizationId,
        payload.actorProfileId,
        scope.courseId,
        {
          promptTokens: aiCall.promptTokens,
          completionTokens: aiCall.completionTokens,
          totalTokens: aiCall.promptTokens + aiCall.completionTokens
        },
        aiCall.model,
        {
          transport: 'gateway',
          workloadDomain: 'exam_import',
          workloadId: scope.importId,
          idempotencyKey: `${scope.importId}:${aiCall.requestHash}`,
          quotaMultiplier: aiCall.quotaMultiplier
        }
      );
    }

    if (aiCall.response === null) continue;

    const applied = applyExamImportAiRegionResponse(validation.draft, aiCall.response, validationContext());
    const suggestedDraft = applied.draft;
    if (!applied.accepted || suggestedDraft === null) continue;

    const savedDraftUpdatedAt = await db.transaction(async (tx) => {
      const lockedImport = await lockExamImportById(scope, tx);
      if (!lockedImport || lockedImport.status !== 'draft_ready' || lockedImport.aiCursor !== examImport.aiCursor)
        return null;

      const currentDraft = await getExamImportDraft(scope, tx);
      if (!currentDraft || currentDraft.updatedAt !== expectedDraftUpdatedAt) return null;

      const auditedImport = await recordExamImportAiRegion(
        scope,
        {
          expectedCursor: lockedImport.aiCursor,
          questionId: aiCall.region.questionId,
          reasons: aiCall.region.reasons,
          requestHash: aiCall.requestHash,
          sentAt: aiCall.sentAt,
          model: aiCall.model
        },
        tx
      );
      if (!auditedImport) return null;

      const savedDraft = await replaceExamImportDraft(
        scope,
        {
          draft: { ...suggestedDraft },
          embeddedAssets: currentDraft.embeddedAssets,
          schemaVersion: suggestedDraft.schemaVersion,
          expiresAt: currentDraft.expiresAt
        },
        tx
      );
      if (!savedDraft) return null;

      const summary = draftSummary(suggestedDraft, lockedImport.warningCount);
      const updatedImport = await updateExamImportDraftSummary(scope, summary, tx);

      return updatedImport === null ? null : savedDraft.updatedAt;
    });

    if (!savedDraftUpdatedAt) return { status: appliedCount > 0 ? 'applied' : 'stale' };

    expectedDraftUpdatedAt = savedDraftUpdatedAt;
    appliedCount++;
  }

  if (appliedCount === 0) return { status: 'rejected' };

  log.info('exam-import-ai-suggestion-applied', {
    importId: scope.importId,
    questionIds: payload.questionIds,
    appliedCount
  });

  return { status: 'applied' };
}
