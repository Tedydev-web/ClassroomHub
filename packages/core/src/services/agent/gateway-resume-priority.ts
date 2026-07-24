import { getGatewayWindowConsumption } from '@cio/db/queries/agent';

import { computeQueuePriority } from './gateway-priority';
import { getGatewaySettings } from './gateway-settings-store';
import { getOrgGatewayLimits } from './gateway-settings-store';

/**
 * Priority for re-dispatching a run that yielded its gateway slot.
 *
 * This is the point where weighted fair queueing actually takes effect: BullMQ
 * evaluates priority at insertion, and a sliced run re-inserts itself after every
 * lease, so recomputing here is what keeps one heavy tenant from monopolising the
 * single shared slot.
 *
 * Consumption is measured over the tightest configured window so an org that
 * burned capacity a week ago is not still being penalised.
 */
export async function computeAgentRunResumePriority(orgId: string): Promise<number> {
  try {
    const settings = await getGatewaySettings();
    const limits = await getOrgGatewayLimits(orgId);

    const models = settings.modelAllowlist.map((entry) => entry.modelId);

    if (models.length === 0 || settings.windows.length === 0) {
      // Nothing configured to measure against; fall back to neutral priority
      // rather than inventing an ordering.
      return computeQueuePriority({ consumedUnits: 0, priorityWeight: limits.priorityWeight });
    }

    const tightestWindow = settings.windows.reduce((shortest, candidate) =>
      candidate.durationMinutes < shortest.durationMinutes ? candidate : shortest
    );

    const consumedUnits = await getGatewayWindowConsumption({
      models,
      windowMinutes: tightestWindow.durationMinutes,
      orgId
    });

    return computeQueuePriority({ consumedUnits, priorityWeight: limits.priorityWeight });
  } catch (error) {
    console.error('computeAgentRunResumePriority falling back to neutral priority:', error);

    // A priority lookup failure must not strand the run: neutral priority keeps
    // it moving, just without the fairness adjustment for this hop.
    return computeQueuePriority({ consumedUnits: 0, priorityWeight: 1 });
  }
}
