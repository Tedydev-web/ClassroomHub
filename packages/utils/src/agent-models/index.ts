/**
 * Shared registry of LLM models the AI assistant can use.
 *
 * This deployment runs on a shared ChatGPT/Codex subscription through the AI
 * gateway, so the picker offers **only Codex models**. Gemini exists purely as
 * the fallback route and is shown to teachers only while the gateway cannot
 * serve — offering it during normal operation would quietly send traffic around
 * the subscription the platform is paying for.
 *
 * Legacy entries stay in `AGENT_MODELS` (but out of the picker) so a model id
 * stored in an old conversation or in localStorage still resolves instead of
 * crashing a lookup.
 */

export const AGENT_MODEL_IDS = [
  // Codex — served through the gateway.
  'gpt-5.4-mini',
  'gpt-5.4',
  'gpt-5.6-luna',
  'gpt-5.6-terra',
  'gpt-5.6-sol',
  // Official API — fallback only.
  'gemini-2.5-flash-lite',
  // Retained for backward compatibility with stored ids; never offered.
  'claude-sonnet-3-5',
  'kimi-k2.6'
] as const;

export type AgentModelId = (typeof AGENT_MODEL_IDS)[number];
export type AgentModelProvider = 'google' | 'openai' | 'anthropic' | 'moonshot';
export type AgentModelCostTier = 'low' | 'high';

/**
 * Which transport is expected to serve a model.
 *
 * - `gateway`  — the shared subscription; the normal route.
 * - `fallback` — official provider API, surfaced only when the gateway is down.
 * - `legacy`   — kept so old stored ids resolve; never offered in the picker.
 */
export type AgentModelRoute = 'gateway' | 'fallback' | 'legacy';

export interface AgentModelDescriptor {
  provider: AgentModelProvider;
  label: string;
  /** The exact model id passed to the provider SDK or the gateway. */
  backendModelId: string;
  /** Whether this model is available on the free plan. */
  isFree: boolean;
  /** Cost tier shown in the model picker — 'low' ($) or 'high' ($$$). */
  costTier: AgentModelCostTier;
  /** Context window size in tokens. Used to show context usage indicator. */
  contextWindow: number;
  route: AgentModelRoute;
}

export const AGENT_MODELS: Record<AgentModelId, AgentModelDescriptor> = {
  'gpt-5.4-mini': {
    provider: 'openai',
    label: 'GPT-5.4 Mini',
    backendModelId: 'gpt-5.4-mini',
    isFree: true,
    costTier: 'low',
    contextWindow: 400_000,
    route: 'gateway'
  },
  'gpt-5.4': {
    provider: 'openai',
    label: 'GPT-5.4',
    backendModelId: 'gpt-5.4',
    // The default must stay free, or every free-plan teacher meets the upgrade
    // modal before writing a single prompt.
    isFree: true,
    costTier: 'low',
    contextWindow: 400_000,
    route: 'gateway'
  },
  'gpt-5.6-luna': {
    provider: 'openai',
    label: 'GPT-5.6 Luna',
    backendModelId: 'gpt-5.6-luna',
    isFree: false,
    costTier: 'high',
    contextWindow: 400_000,
    route: 'gateway'
  },
  'gpt-5.6-terra': {
    provider: 'openai',
    label: 'GPT-5.6 Terra',
    backendModelId: 'gpt-5.6-terra',
    isFree: false,
    costTier: 'high',
    contextWindow: 400_000,
    route: 'gateway'
  },
  'gpt-5.6-sol': {
    provider: 'openai',
    label: 'GPT-5.6 Sol',
    backendModelId: 'gpt-5.6-sol',
    isFree: false,
    costTier: 'high',
    contextWindow: 400_000,
    route: 'gateway'
  },
  'gemini-2.5-flash-lite': {
    provider: 'google',
    label: 'Gemini 2.5 Flash Lite',
    backendModelId: 'gemini-2.5-flash-lite',
    isFree: true,
    costTier: 'low',
    contextWindow: 1_048_576,
    route: 'fallback'
  },
  'claude-sonnet-3-5': {
    provider: 'anthropic',
    label: 'Claude Sonnet 4.6',
    backendModelId: 'claude-sonnet-4-6',
    isFree: false,
    costTier: 'high',
    contextWindow: 1_000_000,
    route: 'legacy'
  },
  'kimi-k2.6': {
    provider: 'moonshot',
    label: 'Kimi K2.6',
    backendModelId: 'kimi-k2.6',
    isFree: true,
    costTier: 'low',
    contextWindow: 262_144,
    route: 'legacy'
  }
};

/** Codex models, cheapest first. The picker's normal contents. */
export const GATEWAY_MODEL_IDS = AGENT_MODEL_IDS.filter(
  (id) => AGENT_MODELS[id].route === 'gateway'
) as readonly AgentModelId[];

/** Official-API models, offered only while the gateway cannot serve. */
export const FALLBACK_MODEL_IDS = AGENT_MODEL_IDS.filter(
  (id) => AGENT_MODELS[id].route === 'fallback'
) as readonly AgentModelId[];

/**
 * Models to show in the picker.
 *
 * While the gateway is serving, only Codex models are offered. When it is not,
 * the fallback models appear so a teacher still has a working option instead of
 * a list of choices that all fail.
 */
export function getPickerModelIds(options?: { gatewayActive?: boolean }): readonly AgentModelId[] {
  const gatewayActive = options?.gatewayActive ?? true;

  return gatewayActive ? GATEWAY_MODEL_IDS : FALLBACK_MODEL_IDS;
}

/**
 * Every model a teacher could legitimately end up on. Used for plan-gating
 * checks, which must consider both routes regardless of current gateway state.
 */
export const UI_PICKER_MODEL_IDS = [...GATEWAY_MODEL_IDS, ...FALLBACK_MODEL_IDS] as const;

/** Balanced Codex model; served by the gateway. */
export const DEFAULT_PICKER_MODEL_ID: AgentModelId = 'gpt-5.4';

/** Used when the gateway is unavailable and the default cannot be served. */
export const DEFAULT_FALLBACK_MODEL_ID: AgentModelId = 'gemini-2.5-flash-lite';
