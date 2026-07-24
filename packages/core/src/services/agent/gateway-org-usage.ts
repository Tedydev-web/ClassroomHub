import type { GatewayUsageSummary } from '@cio/ai-assistant';
import { getGatewayWindowConsumption } from '@cio/db/queries/agent';

import { selectBudgetWindow } from './gateway-settings';
import { getGatewaySettings, getOrgGatewayLimits } from './gateway-settings-store';

/**
 * One org's consumption inside the window its budget is enforced against.
 *
 * This is what the teacher-facing usage meter renders. It reports only the
 * caller's own org — the shared pool total is operator information: a tenant
 * cannot act on it, and exposing it would leak how much other tenants consumed.
 *
 * Returns null whenever there is nothing meaningful to show a progress bar
 * against: gateway off, no window configured, no models allowlisted, or no
 * budget set for this org. Callers render consumption without a denominator in
 * that case rather than inventing one.
 */
export async function getOrgGatewayUsage(orgId: string): Promise<GatewayUsageSummary | null> {
  const settings = await getGatewaySettings();

  if (!settings.enabled) return null;

  const budgetWindow = selectBudgetWindow(settings);

  if (!budgetWindow) return null;

  const models = settings.modelAllowlist.map((entry) => entry.modelId);

  if (models.length === 0) return null;

  const limits = await getOrgGatewayLimits(orgId);

  if (limits.windowBudgetUnits === null) return null;

  const usedUnits = await getGatewayWindowConsumption({
    models,
    windowMinutes: budgetWindow.durationMinutes,
    orgId
  });

  return {
    usedUnits,
    budgetUnits: limits.windowBudgetUnits,
    windowMinutes: budgetWindow.durationMinutes
  };
}
