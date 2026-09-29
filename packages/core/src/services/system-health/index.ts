import { QUEUE_NAMES, getQueue, isRedisConfigured } from '@cio/jobs';

import { getCredentialProbes } from './credential-probes';
import { getEmailAndEndpointProbes } from './email-endpoint-probes';
import { runHealthProbes } from './health-report-runner';
import { getInfrastructureProbes } from './infrastructure-probes';
import type { HealthTransitions, SystemHealthReport } from './types';

export type { HealthCheckResult, HealthGroup, HealthStatus, HealthTransitions, SystemHealthReport } from './types';
export { sendHealthAlertEmail, sendHealthTestEmail, type EmailProbeResult } from './health-notifications';
export { summarizeHealthStatus } from './health-report-runner';

/** Last report written by the scheduled scan, read back by the admin page. */
const LAST_SCHEDULED_REPORT_KEY = 'system-health:last-scheduled-report';
/** Outlives a missed scan or two, so a stale report still shows until the next one lands. */
const LAST_SCHEDULED_REPORT_TTL_SECONDS = 24 * 60 * 60;

export function runSystemHealthChecks(source: SystemHealthReport['source']): Promise<SystemHealthReport> {
  return runHealthProbes(
    [...getInfrastructureProbes(), ...getEmailAndEndpointProbes(), ...getCredentialProbes()],
    source
  );
}

export async function saveScheduledHealthReport(report: SystemHealthReport): Promise<void> {
  if (!isRedisConfigured()) return;

  const client = await getQueue(QUEUE_NAMES.maintenance).client;
  await client.set(LAST_SCHEDULED_REPORT_KEY, JSON.stringify(report), 'EX', LAST_SCHEDULED_REPORT_TTL_SECONDS);
}

export async function readScheduledHealthReport(): Promise<SystemHealthReport | null> {
  if (!isRedisConfigured()) return null;

  const client = await getQueue(QUEUE_NAMES.maintenance).client;
  const raw = await client.get(LAST_SCHEDULED_REPORT_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as SystemHealthReport;
  } catch (error) {
    console.error('readScheduledHealthReport: stored report is not valid JSON', error);
    return null;
  }
}

/**
 * Alerts fire on change, not on state: a check that has been failing for a day was
 * announced when it broke, and repeating that every fifteen minutes trains the reader to
 * ignore the mailbox. The previous report lives in Redis, so restarting the jobs worker
 * does not re-announce known failures; with no previous report at all (first scan, or it
 * expired), every current failure is announced once rather than silently assumed known.
 */
export function diffHealthReports(previous: SystemHealthReport | null, current: SystemHealthReport): HealthTransitions {
  if (!previous) {
    return { newlyFailing: current.checks.filter((check) => check.status === 'fail'), recovered: [] };
  }

  const before = new Map(previous.checks.map((check) => [check.id, check.status]));

  return {
    newlyFailing: current.checks.filter((check) => check.status === 'fail' && before.get(check.id) !== 'fail'),
    recovered: current.checks.filter((check) => check.status !== 'fail' && before.get(check.id) === 'fail')
  };
}
