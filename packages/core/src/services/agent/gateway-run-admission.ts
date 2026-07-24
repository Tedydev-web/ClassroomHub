import { countOrgAgentRunsByState, getGatewayWindowConsumption } from '@cio/db/queries/agent';

import { evaluateGatewayAdmission, type GatewayAdmissionResult } from './gateway-admission';
import { selectBudgetWindow } from './gateway-settings';
import { getGatewaySettings, getOrgGatewayLimits } from './gateway-settings-store';

/**
 * Admission check for starting or resuming a course-generation run.
 *
 * Deliberately separate from `enforceTokenBalance`: self-owned deployments get an
 * unlimited plan allowance, so that check cannot stop one tenant from draining a
 * shared subscription. This gate holds regardless of deployment mode.
 *
 * Skipped entirely when the gateway is switched off — on the official API path
 * each org pays for its own usage, so there is no shared pool to protect.
 */
export async function assertAgentRunAdmitted(params: {
  orgId: string;
  hasOfficialKey: boolean;
}): Promise<GatewayAdmissionResult> {
  const settings = await getGatewaySettings();

  if (!settings.enabled) {
    return { admitted: true, reason: 'admitted', viaFallback: false };
  }

  const [limits, runCounts] = await Promise.all([
    getOrgGatewayLimits(params.orgId),
    countOrgAgentRunsByState(params.orgId)
  ]);

  const models = settings.modelAllowlist.map((entry) => entry.modelId);
  const globalWindowUnits: Record<string, number> = {};
  let orgWindowUnits = 0;

  const budgetWindow = selectBudgetWindow(settings);

  if (models.length > 0 && budgetWindow) {
    const [orgUnits, ...windowTotals] = await Promise.all([
      getGatewayWindowConsumption({
        models,
        windowMinutes: budgetWindow.durationMinutes,
        orgId: params.orgId
      }),
      ...settings.windows.map((window) =>
        getGatewayWindowConsumption({ models, windowMinutes: window.durationMinutes })
      )
    ]);

    orgWindowUnits = orgUnits;
    settings.windows.forEach((window, index) => {
      globalWindowUnits[window.id] = windowTotals[index] ?? 0;
    });
  }

  return evaluateGatewayAdmission({
    settings,
    limits,
    activeRuns: runCounts.active,
    queuedRuns: runCounts.queued,
    orgWindowUnits,
    globalWindowUnits,
    hasFallback: params.hasOfficialKey && settings.fallbackEnabled,
    // Batch work waits for the window to recover rather than paying for overflow.
    allowFallbackOnWindowExhaustion: false,
    now: Date.now()
  });
}

/**
 * Lighter gate for interactive chat.
 *
 * Chat deliberately skips the run-count and window-budget checks: a blocked
 * window makes chat fall back to the official provider, which the org pays for
 * through the existing token balance. Only an operator block is absolute.
 */
export async function assertChatAdmitted(orgId: string): Promise<GatewayAdmissionResult> {
  const settings = await getGatewaySettings();

  if (!settings.enabled) {
    return { admitted: true, reason: 'admitted', viaFallback: false };
  }

  const limits = await getOrgGatewayLimits(orgId);

  if (limits.isBlocked) {
    return {
      admitted: false,
      reason: 'org_blocked',
      detail: limits.blockReason ?? undefined,
      viaFallback: false
    };
  }

  return { admitted: true, reason: 'admitted', viaFallback: false };
}

/** Human-readable message for a rejected admission, safe to show a teacher. */
export function describeAdmissionRejection(result: GatewayAdmissionResult): string {
  switch (result.reason) {
    case 'org_blocked':
      return 'AI generation is disabled for this organization.';
    case 'org_active_limit':
      return 'Another AI generation is already running for this organization. Wait for it to finish.';
    case 'org_queue_limit':
      return 'Too many AI generations are queued for this organization. Wait for one to finish.';
    case 'org_budget_exceeded':
      return 'This organization has used its AI generation capacity for now. Capacity recovers gradually.';
    case 'global_window_exhausted':
      return 'AI generation capacity is temporarily used up. Capacity recovers gradually — try again shortly.';
    case 'gateway_paused':
      return 'AI generation is paused by the administrator.';
    default:
      return 'AI generation is temporarily unavailable.';
  }
}
