import type { HealthCheckResult, HealthProbe, HealthStatus, SystemHealthReport } from './types';

/** No single dependency may hold the whole report hostage. */
export const PROBE_TIMEOUT_MS = 10_000;

const STATUS_RANK: Record<HealthStatus, number> = { unconfigured: 0, ok: 1, warn: 2, fail: 3 };

export function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runProbe(probe: HealthProbe, timeoutMs = PROBE_TIMEOUT_MS): Promise<HealthCheckResult> {
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    const outcome = await Promise.race([probe.run(), timeout]);

    return { id: probe.id, group: probe.group, label: probe.label, ...outcome, latencyMs: Date.now() - startedAt };
  } catch (error) {
    // A probe that throws is a failed check, never a failed report.
    return {
      id: probe.id,
      group: probe.group,
      label: probe.label,
      status: 'fail',
      detail: errorDetail(error),
      latencyMs: Date.now() - startedAt
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Worst status wins; unconfigured checks never raise the overall status. */
export function summarizeHealthStatus(checks: Pick<HealthCheckResult, 'status'>[]): SystemHealthReport['status'] {
  const worst = checks.reduce<HealthStatus>(
    (current, check) => (STATUS_RANK[check.status] > STATUS_RANK[current] ? check.status : current),
    'ok'
  );

  return worst === 'unconfigured' ? 'ok' : worst;
}

export async function runHealthProbes(
  probes: HealthProbe[],
  source: SystemHealthReport['source'],
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<SystemHealthReport> {
  const startedAt = Date.now();
  const checks = await Promise.all(probes.map((probe) => runProbe(probe, timeoutMs)));

  return {
    status: summarizeHealthStatus(checks),
    source,
    checkedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    checks
  };
}
