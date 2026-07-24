import { buildGatewayProviderConfig, type AIProviderConfig } from '@cio/ai-assistant/providers';

import { findAllowlistEntry, type GatewaySettings } from './gateway-settings';
import { getGatewaySettings, invalidateGatewaySettingsCache } from './gateway-settings-store';
import { upsertGatewaySettingsRow } from '@cio/db/queries/agent';
import {
  classifyGatewayFailure,
  nextCircuitStateOnFailure,
  nextCircuitStateOnSuccess,
  type GatewayFailureReason
} from './gateway-circuit-breaker';
import {
  resolveGatewayRoute,
  type GatewayConnection,
  type GatewayRoute,
  type GatewayWorkload
} from './gateway-transport-resolver';

/**
 * Runtime glue between gateway configuration, the routing decision, and the AI
 * SDK provider config the caller ultimately needs.
 *
 * Connection details come from the environment (they are secrets); everything
 * behavioral comes from the database so an operator can change it live.
 */

export type GatewayRuntimeEnv = Record<string, string | undefined>;

/** Reads gateway connection details, defaulting to empty so callers fail closed. */
export function readGatewayConnectionFromEnv(env: GatewayRuntimeEnv = process.env): GatewayConnection {
  return {
    baseURL: (env.AI_GATEWAY_BASE_URL ?? '').trim(),
    authToken: (env.AI_GATEWAY_AUTH_TOKEN ?? '').trim()
  };
}

/**
 * Returns the model id the gateway may serve for this request, or null when it
 * cannot serve the requested model at all.
 *
 * Deliberately never substitutes: if a teacher picked Gemini, the gateway is the
 * wrong route and the caller falls back to the official provider. Swapping in a
 * Codex model to save quota would silently change output quality, which this
 * design forbids.
 */
export function selectGatewayModelId(settings: GatewaySettings, requestedModelId: string): string | null {
  const entry = findAllowlistEntry(settings.modelAllowlist, requestedModelId);

  return entry ? entry.modelId : null;
}

export interface AgentTransportResolution {
  /** Null when the caller should keep its existing official provider config. */
  gatewayConfig: AIProviderConfig | null;
  route: GatewayRoute;
}

/**
 * Decides whether this call should go through the gateway, and builds the
 * provider config when it should.
 *
 * A `queue` or `unavailable` decision returns no config — the caller is expected
 * to queue the work or surface the existing error, not to invent a route.
 */
export async function resolveAgentGatewayTransport(params: {
  requestedModelId: string;
  workload: GatewayWorkload;
  hasOfficialKey: boolean;
  gatewaySlotBusy?: boolean;
  fallbackMonthlyUnitsUsed?: number;
  now?: number;
}): Promise<AgentTransportResolution> {
  const settings = await getGatewaySettings();
  const connection = readGatewayConnectionFromEnv();
  const now = params.now ?? Date.now();

  const route = resolveGatewayRoute({
    settings,
    connection,
    hasOfficialKey: params.hasOfficialKey,
    model: params.requestedModelId,
    workload: params.workload,
    gatewaySlotBusy: params.gatewaySlotBusy ?? false,
    fallbackMonthlyUnitsUsed: params.fallbackMonthlyUnitsUsed,
    now
  });

  if (route.decision !== 'gateway') {
    return { gatewayConfig: null, route };
  }

  const modelId = selectGatewayModelId(settings, params.requestedModelId);

  if (!modelId) {
    // Defensive: the resolver already checks the allowlist, so reaching here
    // means configuration changed between the two reads.
    return {
      gatewayConfig: null,
      route: { ...route, decision: 'official', reason: 'model_not_allowed' }
    };
  }

  return {
    gatewayConfig: buildGatewayProviderConfig({
      baseURL: connection.baseURL,
      authToken: connection.authToken,
      model: modelId
    }),
    route
  };
}

/**
 * Whether the gateway can currently serve, for UI purposes.
 *
 * Reuses the real resolver against the configured default model so the answer
 * cannot drift from what an actual request would do. Deliberately reports only
 * a boolean and a reason code — teachers must never see shared-pool numbers,
 * which they cannot act on and which leak cross-tenant consumption.
 */
export async function getGatewayServingStatus(): Promise<{ active: boolean; reason: string }> {
  const settings = await getGatewaySettings();
  const connection = readGatewayConnectionFromEnv();
  const model = settings.defaultModelId;

  if (!model) {
    return { active: false, reason: 'no_default_model' };
  }

  const route = resolveGatewayRoute({
    settings,
    connection,
    // Asking "can the gateway serve" — fallback availability is a separate question.
    hasOfficialKey: false,
    model,
    workload: 'interactive',
    gatewaySlotBusy: false,
    now: Date.now()
  });

  return { active: route.decision === 'gateway', reason: route.reason };
}

function extractStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;

  const candidate = error as { statusCode?: unknown; status?: unknown };
  const raw = candidate.statusCode ?? candidate.status;

  return typeof raw === 'number' ? raw : undefined;
}

/**
 * Parses a `Retry-After` header into milliseconds.
 *
 * The AI SDK does not honor this header itself, so the breaker has to read it —
 * the upstream knows its own reset window better than our backoff ladder does.
 */
function extractRetryAfterMs(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;

  const headers = (error as { responseHeaders?: Record<string, string> }).responseHeaders;
  const raw = headers?.['retry-after'] ?? headers?.['Retry-After'];

  if (!raw) return undefined;

  const seconds = Number(raw);

  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1_000;
  }

  const asDate = Date.parse(raw);

  return Number.isFinite(asDate) ? Math.max(0, asDate - Date.now()) : undefined;
}

/**
 * Records a failed gateway call and opens (or re-opens) the circuit.
 *
 * Failures here are routing events, not user-facing errors: the caller falls
 * back to the official API, so an open circuit costs money rather than
 * availability.
 */
export async function recordGatewayFailure(error: unknown): Promise<GatewayFailureReason> {
  const statusCode = extractStatusCode(error);
  const reason = classifyGatewayFailure({ statusCode });
  const settings = await getGatewaySettings();

  const next = nextCircuitStateOnFailure(settings, {
    reason,
    now: Date.now(),
    retryAfterMs: extractRetryAfterMs(error)
  });

  try {
    await upsertGatewaySettingsRow({
      circuitState: next.circuitState,
      circuitOpenedAt: next.circuitOpenedAt,
      circuitResumeAfter: next.circuitResumeAfter,
      consecutiveFailures: next.consecutiveFailures
    });
  } finally {
    invalidateGatewaySettingsCache();
  }

  return reason;
}

/** Records a successful gateway call, closing the circuit if it was open. */
export async function recordGatewaySuccess(): Promise<void> {
  const settings = await getGatewaySettings();

  if (settings.circuitState === 'closed' && settings.consecutiveFailures === 0) {
    return;
  }

  const next = nextCircuitStateOnSuccess(settings);

  try {
    await upsertGatewaySettingsRow({
      circuitState: next.circuitState,
      circuitOpenedAt: next.circuitOpenedAt,
      circuitResumeAfter: next.circuitResumeAfter,
      consecutiveFailures: next.consecutiveFailures
    });
  } finally {
    invalidateGatewaySettingsCache();
  }
}
