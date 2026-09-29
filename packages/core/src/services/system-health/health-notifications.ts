import { deliverEmail, escapeHtml } from '@cio/email';
import { OPERATOR_EMAIL, PRODUCT_NAME } from '@cio/utils/constants';

import type { HealthCheckResult, HealthTransitions, SystemHealthReport } from './types';

export interface EmailProbeResult {
  accepted: boolean;
  detail: string;
}

async function sendToOperator(subject: string, html: string): Promise<EmailProbeResult> {
  const [result] = await deliverEmail([{ to: OPERATOR_EMAIL, subject, content: html }]);
  if (!result?.success) return { accepted: false, detail: result?.error ?? 'Delivery failed' };

  // The server's queue receipt ("250 ... queued as ..."), never the credentials.
  const response = (result.details as { response?: unknown } | undefined)?.response;

  return { accepted: true, detail: typeof response === 'string' ? response : 'Accepted by the mail server' };
}

/** A real message through the real send path, so "SMTP authenticates" becomes "mail arrives". */
export function sendHealthTestEmail(): Promise<EmailProbeResult> {
  const sentAt = new Date().toISOString();

  return sendToOperator(
    `[${PRODUCT_NAME}] Test email ${sentAt}`,
    `<p>This is a test message sent from the ${escapeHtml(PRODUCT_NAME)} admin health page at ${sentAt}.</p>` +
      '<p>If it reached this inbox, outgoing mail works end to end. No action needed.</p>'
  );
}

function listItems(checks: HealthCheckResult[]): string {
  return checks
    .map((check) => `<li><strong>${escapeHtml(check.label)}</strong>: ${escapeHtml(check.detail)}</li>`)
    .join('');
}

export function sendHealthAlertEmail(transitions: HealthTransitions, report: SystemHealthReport) {
  const { newlyFailing, recovered } = transitions;
  const headline =
    newlyFailing.length > 0 ? `${newlyFailing.length} check(s) failing` : `${recovered.length} check(s) recovered`;
  const stillFailing = report.checks.filter(
    (check) => check.status === 'fail' && !newlyFailing.some((item) => item.id === check.id)
  );

  const sections = [
    newlyFailing.length > 0 ? `<h3>Now failing</h3><ul>${listItems(newlyFailing)}</ul>` : '',
    recovered.length > 0 ? `<h3>Recovered</h3><ul>${listItems(recovered)}</ul>` : '',
    stillFailing.length > 0 ? `<h3>Still failing</h3><ul>${listItems(stillFailing)}</ul>` : ''
  ].join('');

  return sendToOperator(
    `[${PRODUCT_NAME}] Health: ${headline}`,
    `<p>Scheduled health scan at ${escapeHtml(report.checkedAt)}.</p>${sections}` +
      '<p>Open the admin console, System health page, for the full report.</p>'
  );
}
