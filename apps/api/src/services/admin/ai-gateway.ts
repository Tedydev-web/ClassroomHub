import {
  createAgentRunEvent,
  getAgentRunById,
  getGatewayWindowConsumption,
  getGatewayWindowConsumptionByOrg,
  listAllAgentRuns,
  listGatewayOrgPolicyRows,
  updateAgentRun
} from '@cio/db/queries/agent';
import type { TAiAgentRunStatus } from '@cio/db/types';
import { AppError } from '@api/utils/errors';
import {
  getGatewaySettings,
  saveGatewaySettings,
  saveOrgGatewayPolicy
} from '@cio/core/services/agent/gateway-settings-store';
import { readGatewayConnectionFromEnv } from '@cio/core/services/agent/gateway-runtime';
import type { GatewaySettings } from '@cio/core/services/agent/gateway-settings';

/**
 * Operator view and controls for the shared AI gateway.
 *
 * Every response here is redacted by construction: connection secrets never
 * leave this module, and the gateway's own OAuth credentials live only inside
 * the sidecar container.
 */

/**
 * A live completion probe costs real quota (~309 prompt tokens even for a
 * trivial request), so it is cached. Without this, polling a health dashboard
 * would slowly drain the very subscription it reports on.
 */
const SERVE_PROBE_CACHE_TTL_MS = 60_000;

let cachedServeProbe: { ok: boolean; detail: string; checkedAt: string } | null = null;
let cachedServeProbeAt = 0;

export interface GatewayHealthReport {
  configured: boolean;
  enabled: boolean;
  paused: boolean;
  pauseReason: string | null;
  circuitState: GatewaySettings['circuitState'];
  circuitResumeAfter: string | null;
  consecutiveFailures: number;
  checks: {
    reachable: { ok: boolean; detail: string };
    /** Null when the probe is skipped because the gateway is not usable anyway. */
    canServe: { ok: boolean; detail: string; checkedAt: string } | null;
  };
  /** Allowlisted models the proxy does not currently advertise. */
  unrecognizedModels: string[];
}

/**
 * Layer 1: reachability and key validity. Costs no model tokens.
 *
 * Also used to spot allowlist drift — but note the proxy's catalog advertises
 * models it cannot actually serve (Claude entries appear with no Claude auth),
 * so a model *missing* from it is meaningful while its presence is not.
 */
async function probeReachable(
  baseURL: string,
  authToken: string
): Promise<{ ok: boolean; detail: string; advertisedModels: string[] }> {
  try {
    const response = await fetch(`${baseURL.replace(/\/$/, '')}/v1/models`, {
      headers: { Authorization: `Bearer ${authToken}` },
      signal: AbortSignal.timeout(5_000)
    });

    if (response.status === 401 || response.status === 403) {
      return { ok: false, detail: 'Gateway rejected the configured key', advertisedModels: [] };
    }

    if (!response.ok) {
      return { ok: false, detail: `Gateway returned HTTP ${response.status}`, advertisedModels: [] };
    }

    const body = (await response.json()) as { data?: Array<{ id?: string }> };
    const advertisedModels = (body.data ?? []).map((entry) => entry.id).filter((id): id is string => Boolean(id));

    return { ok: true, detail: 'Reachable and authenticated', advertisedModels };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error';

    return { ok: false, detail: `Gateway unreachable: ${detail}`, advertisedModels: [] };
  }
}

/** Layer 2: proves the upstream subscription can actually serve. Cached. */
async function probeCanServe(
  baseURL: string,
  authToken: string,
  modelId: string,
  now: number
): Promise<{ ok: boolean; detail: string; checkedAt: string }> {
  if (cachedServeProbe && now - cachedServeProbeAt < SERVE_PROBE_CACHE_TTL_MS) {
    return cachedServeProbe;
  }

  let result: { ok: boolean; detail: string; checkedAt: string };

  try {
    const response = await fetch(`${baseURL.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'ok' }],
        max_tokens: 1
      }),
      signal: AbortSignal.timeout(30_000)
    });

    if (response.status === 429) {
      result = { ok: false, detail: 'Subscription quota exhausted', checkedAt: new Date(now).toISOString() };
    } else if (response.status === 401 || response.status === 403) {
      result = { ok: false, detail: 'Gateway auth expired — re-authenticate', checkedAt: new Date(now).toISOString() };
    } else if (!response.ok) {
      result = {
        ok: false,
        detail: `Upstream returned HTTP ${response.status}`,
        checkedAt: new Date(now).toISOString()
      };
    } else {
      result = { ok: true, detail: 'Upstream served a probe request', checkedAt: new Date(now).toISOString() };
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error';
    result = { ok: false, detail: `Probe failed: ${detail}`, checkedAt: new Date(now).toISOString() };
  }

  cachedServeProbe = result;
  cachedServeProbeAt = now;

  return result;
}

export async function getGatewayHealth(options?: { skipServeProbe?: boolean }): Promise<GatewayHealthReport> {
  const settings = await getGatewaySettings();
  const connection = readGatewayConnectionFromEnv();
  const configured = Boolean(connection.baseURL && connection.authToken);

  const base: GatewayHealthReport = {
    configured,
    enabled: settings.enabled,
    paused: settings.pausedAt !== null,
    pauseReason: settings.pauseReason,
    circuitState: settings.circuitState,
    circuitResumeAfter: settings.circuitResumeAfter,
    consecutiveFailures: settings.consecutiveFailures,
    checks: {
      reachable: { ok: false, detail: 'Gateway connection is not configured' },
      canServe: null
    },
    unrecognizedModels: []
  };

  if (!configured) return base;

  const reachable = await probeReachable(connection.baseURL, connection.authToken);
  base.checks.reachable = { ok: reachable.ok, detail: reachable.detail };

  if (reachable.ok && reachable.advertisedModels.length > 0) {
    const advertised = new Set(reachable.advertisedModels);
    base.unrecognizedModels = settings.modelAllowlist
      .map((entry) => entry.modelId)
      .filter((modelId) => !advertised.has(modelId));
  }

  const probeModel = settings.lightModelId ?? settings.defaultModelId;

  if (reachable.ok && probeModel && !options?.skipServeProbe) {
    base.checks.canServe = await probeCanServe(connection.baseURL, connection.authToken, probeModel, Date.now());
  }

  return base;
}

export interface GatewayQuotaReport {
  windows: Array<{ id: string; durationMinutes: number; capUnits: number; usedUnits: number; percentUsed: number }>;
  topOrgs: Array<{ orgId: string; units: number }>;
}

export async function getGatewayQuota(): Promise<GatewayQuotaReport> {
  const settings = await getGatewaySettings();
  const models = settings.modelAllowlist.map((entry) => entry.modelId);

  if (models.length === 0 || settings.windows.length === 0) {
    return { windows: [], topOrgs: [] };
  }

  const windowTotals = await Promise.all(
    settings.windows.map((window) => getGatewayWindowConsumption({ models, windowMinutes: window.durationMinutes }))
  );

  const tightestWindow = settings.windows.reduce((shortest, candidate) =>
    candidate.durationMinutes < shortest.durationMinutes ? candidate : shortest
  );

  const topOrgs = await getGatewayWindowConsumptionByOrg({
    models,
    windowMinutes: tightestWindow.durationMinutes
  });

  return {
    windows: settings.windows.map((window, index) => {
      const usedUnits = windowTotals[index] ?? 0;

      return {
        id: window.id,
        durationMinutes: window.durationMinutes,
        capUnits: window.capUnits,
        usedUnits,
        percentUsed: window.capUnits > 0 ? Math.round((usedUnits / window.capUnits) * 100) : 0
      };
    }),
    topOrgs: topOrgs.slice(0, 20)
  };
}

/** Settings view with connection secrets omitted entirely — never masked, absent. */
export async function getRedactedGatewaySettings(): Promise<GatewaySettings & { connectionConfigured: boolean }> {
  const settings = await getGatewaySettings();
  const connection = readGatewayConnectionFromEnv();

  return { ...settings, connectionConfigured: Boolean(connection.baseURL && connection.authToken) };
}

export async function pauseGateway(reason: string, pausedBy: string | null): Promise<GatewaySettings> {
  return saveGatewaySettings({
    pausedAt: new Date().toISOString(),
    pauseReason: reason,
    pausedBy
  });
}

export async function resumeGateway(): Promise<GatewaySettings> {
  return saveGatewaySettings({ pausedAt: null, pauseReason: null, pausedBy: null });
}

/** Forces the breaker closed after an operator has fixed the underlying cause. */
export async function resetGatewayBreaker(): Promise<GatewaySettings> {
  return saveGatewaySettings({
    circuitState: 'closed',
    circuitOpenedAt: null,
    circuitResumeAfter: null,
    consecutiveFailures: 0
  });
}

export async function updateGatewaySettings(values: Record<string, unknown>): Promise<GatewaySettings> {
  return saveGatewaySettings(values);
}

export async function listOrgGatewayPolicies() {
  const [policies, quota] = await Promise.all([listGatewayOrgPolicyRows(), getGatewayQuota()]);
  const consumptionByOrg = new Map(quota.topOrgs.map((entry) => [entry.orgId, entry.units]));

  return {
    policies: policies.map((policy) => ({
      orgId: policy.orgId,
      priorityWeight: policy.priorityWeight,
      maxActiveRuns: policy.maxActiveRuns,
      maxQueuedRuns: policy.maxQueuedRuns,
      windowBudgetUnits: policy.windowBudgetUnits,
      isBlocked: policy.isBlocked,
      blockReason: policy.blockReason,
      consumedUnits: consumptionByOrg.get(policy.orgId) ?? 0
    })),
    // Orgs consuming capacity without a customised policy row still matter
    // operationally — they are the ones running on pure defaults.
    consumptionOnly: quota.topOrgs.filter((entry) => !policies.some((policy) => policy.orgId === entry.orgId))
  };
}

export async function updateOrgGatewayPolicy(orgId: string, values: Record<string, unknown>) {
  return saveOrgGatewayPolicy(orgId, values);
}

/** Cross-org run listing for triage: who is consuming the shared slot right now. */
export async function listGatewayRuns(params: { statuses?: TAiAgentRunStatus[]; limit?: number }) {
  const runs = await listAllAgentRuns(params);

  return runs.map((run) => ({
    id: run.id,
    orgId: run.orgId,
    courseId: run.courseId,
    userId: run.userId,
    status: run.status,
    phase: run.phase,
    progressPercent: run.progressPercent,
    updatedAt: run.updatedAt,
    // Surfaces how many slices a run has consumed, which is the signal for
    // whether it is progressing or stuck.
    totalRounds: Number((run.executionCursor as Record<string, unknown> | null)?.totalRounds ?? 0)
  }));
}

/**
 * Force-cancels any organization's run.
 *
 * Marks the run canceled rather than killing the worker: the runner checks for
 * cancellation between rounds, so the run stops at a safe boundary instead of
 * mid-tool-call.
 */
export async function forceCancelGatewayRun(runId: string) {
  const run = await getAgentRunById(runId);

  if (!run) {
    throw new AppError('Agent run not found', 'AGENT_RUN_NOT_FOUND', 404);
  }

  const canceled = await updateAgentRun({
    runId: run.id,
    userId: run.userId,
    status: 'canceled',
    phase: 'canceled',
    currentStepKey: null,
    workerId: null,
    lockedAt: null,
    finishedAt: new Date().toISOString()
  });

  if (!canceled) {
    // The run existed a moment ago, so a null here means it was deleted or its
    // ownership changed between the two calls.
    throw new AppError('Agent run could not be canceled', 'AGENT_RUN_CANCEL_FAILED', 409);
  }

  await createAgentRunEvent({
    runId: run.id,
    eventType: 'run.canceled',
    message: 'Run force-canceled by the platform operator',
    payload: { source: 'admin' }
  });

  return { id: canceled.id, status: canceled.status };
}

/** Test seam: clears the cached serve probe. */
export function resetGatewayHealthCache(): void {
  cachedServeProbe = null;
  cachedServeProbeAt = 0;
}
