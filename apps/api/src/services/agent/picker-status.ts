import { AGENT_MODELS, DEFAULT_PICKER_MODEL_ID, FALLBACK_MODEL_IDS } from '@cio/utils/agent-models';
import type { PickerModelSummary } from '@cio/ai-assistant';
import { getGatewaySettings } from '@cio/core/services/agent/gateway-settings-store';
import { resolveDefaultPickerModelId, resolvePickerModels } from '@cio/core/services/agent/picker-models';

/**
 * Resolves the `pickerModels`/`defaultModelId` fields of `GET /agent/status`.
 *
 * Source of truth is the gateway's model allowlist (DB, super-admin managed)
 * while the gateway is serving. When it is not, the picker falls back to the
 * registry's fallback models so a teacher still has a working option instead
 * of a list of choices that would all fail.
 */
export async function resolvePickerStatus(params: {
  gatewayActive: boolean;
}): Promise<{ pickerModels: PickerModelSummary[]; defaultModelId: string }> {
  const settings = await getGatewaySettings();

  const pickerModels: PickerModelSummary[] = params.gatewayActive
    ? resolvePickerModels(settings).map((model) => ({ id: model.id, label: model.label, isFree: model.isFree }))
    : FALLBACK_MODEL_IDS.map((id) => ({ id, label: AGENT_MODELS[id].label, isFree: AGENT_MODELS[id].isFree }));

  const defaultModelId = resolveDefaultPickerModelId(pickerModels, settings.defaultModelId, DEFAULT_PICKER_MODEL_ID);

  return { pickerModels, defaultModelId };
}
