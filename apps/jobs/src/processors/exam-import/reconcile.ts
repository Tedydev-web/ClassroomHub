import {
  listExpiredExamImportDrafts,
  listQueuedExamImports,
  listTerminalExamImportSourceCheckpoints,
  markExamImportDraftCleanupCompleted,
  markExamImportDraftExpired,
  reapStuckExamImports
} from '@cio/db/queries/exam-import';
import { deleteJobStep } from '@cio/db/queries/jobs';
import { enqueueExamImport } from '@cio/jobs';

import { log } from '../../utils/logger';
import { deleteObjectFromBucket, deleteObjectsByPrefix } from '../../utils/storage';
import { getStorageConfig } from '../../config/storage';
import { cleanupExamImportAttemptOutputs, cleanupExamImportSourceArtifact } from './process';

export async function reconcileExamImports(limit: number, staleBeforeIso: string) {
  const reapedImports = await reapStuckExamImports(staleBeforeIso);
  for (const examImport of reapedImports) {
    await cleanupExamImportSourceArtifact(examImport.id, true);
  }
  const terminalSourceCheckpoints = await listTerminalExamImportSourceCheckpoints(limit);
  for (const checkpoint of terminalSourceCheckpoints) {
    try {
      const mediaPrefix = `exam-import/${checkpoint.organizationId}/${checkpoint.importId}/`;
      await deleteObjectsByPrefix(getStorageConfig().bucketMedia, mediaPrefix);
      if (checkpoint.sourceStepStatus === 'completed') {
        const sourceCleanupCompleted = await cleanupExamImportSourceArtifact(checkpoint.importId, false);
        if (!sourceCleanupCompleted) continue;
      } else {
        await cleanupExamImportAttemptOutputs({
          importId: checkpoint.importId,
          organizationId: checkpoint.organizationId,
          courseId: checkpoint.courseId
        });
        await deleteJobStep('exam-import', checkpoint.importId, 'source');
      }
    } catch (error) {
      log.error('exam-import-terminal-source-cleanup-failed', {
        importId: checkpoint.importId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  const expiredDrafts = await listExpiredExamImportDrafts(new Date().toISOString(), limit);
  let expired = 0;
  let cleanupFailed = 0;
  const mediaBucketName = getStorageConfig().bucketMedia;
  for (const expiredDraft of expiredDrafts) {
    if (expiredDraft.status === 'draft_ready') {
      const markedExpired = await markExamImportDraftExpired(expiredDraft.scope, new Date().toISOString());
      if (!markedExpired) continue;
    }

    try {
      const storageKeys = new Set(expiredDraft.embeddedAssets.map((asset) => asset.storageKey));
      for (const storageKey of storageKeys) {
        await deleteObjectFromBucket(mediaBucketName, storageKey);
      }
      await markExamImportDraftCleanupCompleted(expiredDraft.scope.importId);
      expired += 1;
    } catch (error) {
      cleanupFailed += 1;
      log.error('exam-import-expired-draft-cleanup-failed', {
        importId: expiredDraft.scope.importId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  const queuedImports = await listQueuedExamImports(limit);
  let enqueued = 0;
  let failed = 0;

  for (const examImport of queuedImports) {
    try {
      const payload = {
        importId: examImport.id,
        organizationId: examImport.organizationId,
        courseId: examImport.courseId
      };
      if (examImport.status === 'waiting_for_ai') {
        const checkpoint = `${examImport.status}-${new Date(examImport.updatedAt).getTime()}`;
        await enqueueExamImport(payload, {}, checkpoint);
      } else {
        await enqueueExamImport(payload);
      }
      enqueued += 1;
    } catch (error) {
      failed += 1;
      log.error('exam-import-reconcile-enqueue-failed', {
        importId: examImport.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  return {
    scanned: queuedImports.length,
    enqueued,
    failed,
    reaped: reapedImports.length,
    expired,
    cleanupFailed
  };
}
