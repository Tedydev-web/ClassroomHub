import {
  AGENT_MODEL_IDS,
  AGENT_MODELS,
  type AgentModelCostTier,
  type AgentModelId,
  type AgentModelProvider
} from '@cio/utils/agent-models';

import type { GatewaySettings } from './gateway-settings';

/**
 * Resolves the gateway allowlist into the model list the chat picker offers.
 *
 * The allowlist (DB, super-admin managed) is the single source of truth for
 * *which* models a user may pick — the registry only supplies technical
 * metadata (provider, cost tier, context window) for whichever ids the
 * allowlist names. An allowlist entry whose `modelId` has no registry
 * descriptor is skipped rather than surfaced or thrown: a picker missing one
 * model is recoverable, a crashed picker is not.
 */
export interface PickerModel {
  id: AgentModelId;
  /** Display label — taken from the allowlist entry, not the registry, so an operator can rename it without a deploy. */
  label: string;
  provider: AgentModelProvider;
  isFree: boolean;
  costTier: AgentModelCostTier;
  contextWindow: number;
}

function isKnownAgentModelId(modelId: string): modelId is AgentModelId {
  return (AGENT_MODEL_IDS as readonly string[]).includes(modelId);
}

/**
 * Builds the picker list from gateway settings: visible allowlist entries,
 * joined against the registry for provider/cost/context metadata, in
 * allowlist order.
 */
export function resolvePickerModels(settings: GatewaySettings): PickerModel[] {
  return settings.modelAllowlist.flatMap((entry): PickerModel[] => {
    if (entry.visible === false) return [];

    if (!isKnownAgentModelId(entry.modelId)) {
      console.warn(`[picker-models] allowlist entry "${entry.modelId}" has no registry descriptor; skipping`);
      return [];
    }

    const descriptor = AGENT_MODELS[entry.modelId];

    return [
      {
        id: entry.modelId,
        label: entry.label,
        provider: descriptor.provider,
        isFree: descriptor.isFree,
        costTier: descriptor.costTier,
        contextWindow: descriptor.contextWindow
      }
    ];
  });
}

/**
 * Picks the model the picker should default to: the configured default when
 * it is actually offered, else the first offered model, else the caller's
 * fallback constant. Never returns an id absent from `pickerModels` unless the
 * list itself is empty, so the frontend never defaults to an unselectable model.
 */
export function resolveDefaultPickerModelId(
  pickerModels: Array<{ id: string }>,
  preferredModelId: string | null,
  fallbackModelId: string
): string {
  if (preferredModelId && pickerModels.some((model) => model.id === preferredModelId)) {
    return preferredModelId;
  }

  return pickerModels[0]?.id ?? fallbackModelId;
}
