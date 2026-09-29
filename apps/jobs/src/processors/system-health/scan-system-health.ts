import {
  confirmFailingChecks,
  diffHealthReports,
  readScheduledHealthReport,
  runSystemHealthChecks,
  saveScheduledHealthReport,
  sendHealthAlertEmail
} from '@cio/core/services/system-health/index';

import { log } from '../../utils/logger';

/**
 * Scheduled platform health scan: run every check, email the operator about checks that
 * started or stopped failing, and keep the report for the admin page.
 *
 * The report is only saved once any alert it owes has been accepted. Saving first would
 * mark a failure as announced even when the announcement itself bounced, and it would
 * never be sent again; not saving means the next scan retries it.
 *
 * Failures are re-checked once before they count, so a restart during a deploy is not
 * reported as an outage.
 */
export const FAILURE_CONFIRM_DELAY_MS = 60_000;

export async function scanSystemHealth(confirmDelayMs = FAILURE_CONFIRM_DELAY_MS) {
  const [previous, firstPass] = await Promise.all([readScheduledHealthReport(), runSystemHealthChecks('jobs')]);
  const report = await confirmFailingChecks(firstPass, confirmDelayMs);
  const transitions = diffHealthReports(previous, report);
  const failing = report.checks.filter((check) => check.status === 'fail').map((check) => check.id);

  if (report.status === 'ok') log.info('system-health-ok', { durationMs: report.durationMs });
  else log.warn('system-health-degraded', { status: report.status, failing });

  const owesAlert = transitions.newlyFailing.length > 0 || transitions.recovered.length > 0;

  if (owesAlert) {
    const delivery = await sendHealthAlertEmail(transitions, report).catch((error: unknown) => ({
      accepted: false,
      detail: error instanceof Error ? error.message : String(error)
    }));

    if (!delivery.accepted) {
      log.error('system-health-alert-undelivered', {
        detail: delivery.detail,
        newlyFailing: transitions.newlyFailing.map((check) => check.id),
        recovered: transitions.recovered.map((check) => check.id)
      });
      return { status: report.status, alerted: false, failing };
    }

    log.info('system-health-alert-sent', {
      newlyFailing: transitions.newlyFailing.map((check) => check.id),
      recovered: transitions.recovered.map((check) => check.id)
    });
  }

  await saveScheduledHealthReport(report);

  return { status: report.status, alerted: owesAlert, failing };
}
