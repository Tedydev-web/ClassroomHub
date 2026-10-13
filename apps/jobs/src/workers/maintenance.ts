import './../bootstrap';

import { Worker } from 'bullmq';

import { runAnalyticsRollupDaily } from '@cio/analytics';
import { purgeAssetStorage } from '@cio/core/services/assets/assets';
import { reconcileCourseRolesToOrgRole } from '@cio/core/services/organization/course-roles';
import { checkStorageHealth } from '@cio/core/services/system-health/storage-health';
import {
  ANALYTICS_DAILY_ROLLUP_INTERVAL_MS,
  EXAM_IMPORT_RECONCILE_INTERVAL_MS,
  MEDIA_JOB_REAP_INTERVAL_MS,
  STORAGE_HEALTH_CHECK_INTERVAL_MS,
  SYSTEM_HEALTH_SCAN_INTERVAL_MS
} from './maintenance-schedule';
import { scanSystemHealth } from '../processors/system-health/scan-system-health';
import { pruneDeadLetterJobsOlderThan, reapStuckMediaJobs } from '@cio/db/queries';
import {
  listEarlyAdopterClaimsDueForReminder,
  markEarlyAdopterClaimReminded,
  reconcileMemberLastActive
} from '@cio/db/queries/organization';
import { buildEarlyAdopterClaimUrl, deriveEarlyAdopterClaimToken } from '@cio/core/services/early-adopter/claim-token';
import { capAutoLessonVersionsPerLanguage, pruneAutoLessonVersions } from '@cio/db/queries/lesson/version';
import {
  JOB_NAMES,
  QUEUE_NAMES,
  createQueueOnConnection,
  ZAnalyticsDailyRollupPayload,
  ZAssetStorageCleanupPayload,
  ZCourseRoleReconcilePayload,
  ZDeadLetterCleanupPayload,
  ZExamImportReconcilePayload,
  ZEarlyAdopterClaimReminderPayload,
  ZLessonVersionRetentionPayload,
  ZMediaJobReapPayload,
  ZMemberActivityReconcilePayload,
  ZRetentionCompactPayload,
  createRedisConnection,
  enqueueEmailSend
} from '@cio/jobs';

import { reconcileExamImports } from '../processors/exam-import';
import { errorMessage } from '../utils/cancel';
import { log } from '../utils/logger';

const connection = createRedisConnection();

const worker = new Worker(
  QUEUE_NAMES.maintenance,
  async (job) => {
    if (job.name === JOB_NAMES.maintenance.deadLetterCleanup) {
      const data = ZDeadLetterCleanupPayload.parse(job.data ?? {});
      const cutoff = new Date(Date.now() - data.olderThanDays * 86_400 * 1_000).toISOString();
      const deleted = await pruneDeadLetterJobsOlderThan(cutoff);
      log.info('dead-letter-cleanup-done', { deleted, cutoff });
      return { deleted };
    }

    if (job.name === JOB_NAMES.maintenance.retentionCompact) {
      ZRetentionCompactPayload.parse(job.data ?? {});
      // Retention windows for media_job, job_step, email_delivery to be wired
      // alongside their respective queries. Logged for now so the schedule
      // is observable without silently dropping data.
      log.info('retention-compact-noop', { reason: 'not-yet-implemented' });
      return { compacted: 0 };
    }

    if (job.name === JOB_NAMES.maintenance.lessonVersionRetention) {
      const data = ZLessonVersionRetentionPayload.parse(job.data ?? {});
      const thinned = await pruneAutoLessonVersions({
        keepAllHours: data.keepAllHours,
        hourlyDays: data.hourlyDays,
        dailyDays: data.dailyDays
      });
      const capped = await capAutoLessonVersionsPerLanguage(data.maxAutoPerLanguage);

      log.info('lesson-version-retention-done', {
        thinned,
        capped,
        keepAllHours: data.keepAllHours,
        hourlyDays: data.hourlyDays,
        dailyDays: data.dailyDays,
        maxAutoPerLanguage: data.maxAutoPerLanguage
      });

      return { thinned, capped };
    }

    if (job.name === JOB_NAMES.maintenance.mediaJobReap) {
      const data = ZMediaJobReapPayload.parse(job.data ?? {});
      const cutoffIso = new Date(Date.now() - data.staleAfterMinutes * 60 * 1_000).toISOString();
      const reaped = await reapStuckMediaJobs(cutoffIso);

      if (reaped.length > 0) {
        log.warn('media-job-reap-done', {
          reaped: reaped.length,
          cutoffIso,
          ids: reaped.map((row) => row.id)
        });
      }

      return { reaped: reaped.length };
    }

    if (job.name === JOB_NAMES.maintenance.examImportReconcile) {
      const data = ZExamImportReconcilePayload.parse(job.data ?? {});
      const staleBeforeIso = new Date(Date.now() - data.staleAfterMinutes * 60 * 1_000).toISOString();
      const result = await reconcileExamImports(data.limit, staleBeforeIso);

      log.info('exam-import-reconcile-done', {
        ...result
      });

      return result;
    }

    if (job.name === JOB_NAMES.maintenance.assetStorageCleanup) {
      const data = ZAssetStorageCleanupPayload.parse(job.data ?? {});
      await purgeAssetStorage(data);
      log.info('asset-storage-cleanup-done', {
        assetId: data.assetId,
        prefixes: data.prefixes.length,
        keys: data.keys.length
      });
      return { assetId: data.assetId };
    }

    if (job.name === JOB_NAMES.maintenance.storageHealthCheck) {
      const health = await checkStorageHealth();

      // Warn, loudly, with the bucket and the reason. The outage this exists for was
      // invisible precisely because the only signal was a teacher being told to retry.
      if (health.ok) log.info('storage-health-ok', { buckets: health.buckets.length });
      else
        log.error('storage-health-failed', {
          failed: health.buckets.filter((bucket) => !bucket.ok)
        });

      return health;
    }

    // The retry path for a role clamp that failed inline. Without this branch the retry was
    // queued and never run, leaving a demoted admin with course instructor access.
    if (job.name === JOB_NAMES.maintenance.courseRoleReconcile) {
      const data = ZCourseRoleReconcilePayload.parse(job.data ?? {});
      const demoted = await reconcileCourseRolesToOrgRole(data.organizationId, data.profileId);

      if (demoted > 0) {
        log.warn('course-role-reconcile-demoted', {
          organizationId: data.organizationId,
          profileId: data.profileId,
          demoted
        });
      }

      return { demoted };
    }

    if (job.name === JOB_NAMES.maintenance.memberActivityReconcile) {
      const data = ZMemberActivityReconcilePayload.parse(job.data ?? {});
      const updated = await reconcileMemberLastActive(data.lookbackDays);
      log.info('member-activity-reconcile-done', { updated, lookbackDays: data.lookbackDays });
      return { updated };
    }

    if (job.name === JOB_NAMES.maintenance.analyticsDailyRollup) {
      const data = ZAnalyticsDailyRollupPayload.parse(job.data ?? {});
      const result = await runAnalyticsRollupDaily({ daysAgo: data.daysAgo });
      log.info('analytics-rollup-done', result);
      return result;
    }

    if (job.name === JOB_NAMES.maintenance.systemHealthScan) {
      return scanSystemHealth();
    }

    if (job.name === JOB_NAMES.maintenance.earlyAdopterClaimReminder) {
      const data = ZEarlyAdopterClaimReminderPayload.parse(job.data ?? {});
      const cutoff = new Date(Date.now() - data.remindAfterDays * 86_400 * 1_000).toISOString();
      const due = await listEarlyAdopterClaimsDueForReminder(cutoff, data.batchSize);
      let reminded = 0;

      for (const claim of due) {
        const claimUrl = buildEarlyAdopterClaimUrl(deriveEarlyAdopterClaimToken(claim.polarSubscriptionId));

        await enqueueEmailSend(
          { kind: 'template', template: 'earlyAdopterReminder', to: claim.email, fields: { claimUrl } },
          { idempotencyKey: `early-adopter-reminder:${claim.polarSubscriptionId}` }
        );
        await markEarlyAdopterClaimReminded(claim.id);
        reminded += 1;
      }

      log.info('early-adopter-claim-reminder-done', { due: due.length, reminded });
      return { reminded };
    }

    throw new Error(`Unknown maintenance job: ${job.name}`);
  },
  { connection, concurrency: 1 }
);

/**
 * BullMQ repeatable schedulers. `upsertJobScheduler` is idempotent on the scheduler id, so
 * it is safe to call on every worker boot. The cadences live in `maintenance-schedule`.
 */
// BullMQ requires a dedicated connection per Worker; give the queue its own so
// the scheduler upsert doesn't piggyback on the worker's blocking client.
// `createQueueOnConnection` is how it gets that connection without also losing
// the queue defaults — see its comment for what losing them cost.
const schedulerConnection = createRedisConnection();
const maintenanceQueue = createQueueOnConnection(QUEUE_NAMES.maintenance, schedulerConnection);

async function registerSchedulers(): Promise<void> {
  try {
    await maintenanceQueue.upsertJobScheduler(
      'media-job-reap-scheduler',
      { every: MEDIA_JOB_REAP_INTERVAL_MS },
      { name: JOB_NAMES.maintenance.mediaJobReap, data: {} }
    );
    log.info('maintenance-scheduler-registered', {
      name: JOB_NAMES.maintenance.mediaJobReap,
      everyMs: MEDIA_JOB_REAP_INTERVAL_MS
    });

    await maintenanceQueue.upsertJobScheduler(
      'exam-import-reconcile-scheduler',
      { every: EXAM_IMPORT_RECONCILE_INTERVAL_MS },
      { name: JOB_NAMES.maintenance.examImportReconcile, data: {} }
    );
    log.info('maintenance-scheduler-registered', {
      name: JOB_NAMES.maintenance.examImportReconcile,
      everyMs: EXAM_IMPORT_RECONCILE_INTERVAL_MS
    });

    await maintenanceQueue.upsertJobScheduler(
      'storage-health-check-scheduler',
      { every: STORAGE_HEALTH_CHECK_INTERVAL_MS },
      { name: JOB_NAMES.maintenance.storageHealthCheck, data: {} }
    );
    log.info('maintenance-scheduler-registered', {
      name: JOB_NAMES.maintenance.storageHealthCheck,
      everyMs: STORAGE_HEALTH_CHECK_INTERVAL_MS
    });

    await maintenanceQueue.upsertJobScheduler(
      'system-health-scan-scheduler',
      { every: SYSTEM_HEALTH_SCAN_INTERVAL_MS },
      { name: JOB_NAMES.maintenance.systemHealthScan, data: {} }
    );
    log.info('maintenance-scheduler-registered', {
      name: JOB_NAMES.maintenance.systemHealthScan,
      everyMs: SYSTEM_HEALTH_SCAN_INTERVAL_MS
    });

    await maintenanceQueue.upsertJobScheduler(
      'analytics-daily-rollup-scheduler',
      { every: ANALYTICS_DAILY_ROLLUP_INTERVAL_MS },
      { name: JOB_NAMES.maintenance.analyticsDailyRollup, data: {} }
    );
    log.info('analytics-rollup-scheduler-registered', {
      name: JOB_NAMES.maintenance.analyticsDailyRollup,
      everyMs: ANALYTICS_DAILY_ROLLUP_INTERVAL_MS
    });

    await maintenanceQueue.upsertJobScheduler(
      'member-activity-reconcile-scheduler',
      { every: 86_400_000 },
      { name: JOB_NAMES.maintenance.memberActivityReconcile, data: {} }
    );
    log.info('member-activity-reconcile-scheduler-registered', {
      name: JOB_NAMES.maintenance.memberActivityReconcile,
      everyMs: 86_400_000
    });

    await maintenanceQueue.upsertJobScheduler(
      'lesson-version-retention-scheduler',
      { every: 86_400_000 },
      { name: JOB_NAMES.maintenance.lessonVersionRetention, data: {} }
    );
    log.info('lesson-version-retention-scheduler-registered', {
      name: JOB_NAMES.maintenance.lessonVersionRetention,
      everyMs: 86_400_000
    });

    await maintenanceQueue.upsertJobScheduler(
      'early-adopter-claim-reminder-scheduler',
      { every: 86_400_000 },
      { name: JOB_NAMES.maintenance.earlyAdopterClaimReminder, data: {} }
    );
    log.info('early-adopter-claim-reminder-scheduler-registered', {
      name: JOB_NAMES.maintenance.earlyAdopterClaimReminder,
      everyMs: 86_400_000
    });
  } catch (err) {
    log.error('maintenance-scheduler-register-failed', { error: errorMessage(err) });
  }
}

void registerSchedulers();

worker.on('ready', () => log.info('maintenance-worker-ready'));
worker.on('failed', (job, err) =>
  log.error('maintenance-job-failed', { jobName: job?.name, error: errorMessage(err) })
);
worker.on('error', (err) => log.error('maintenance-worker-error', { error: errorMessage(err) }));

const shutdown = async (signal: string) => {
  log.info('maintenance-worker-shutdown', { signal });
  await worker.close();
  await maintenanceQueue.close();
  await schedulerConnection.quit();
  await connection.quit();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
