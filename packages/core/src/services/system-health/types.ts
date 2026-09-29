/**
 * Shapes shared by the on-demand health report (API) and the scheduled scan (jobs).
 *
 * `unconfigured` is its own state rather than a failure: an integration nobody turned on is
 * not an outage, and folding it into `fail` would make every scan alert about features the
 * deployment never used.
 */
export type HealthStatus = 'ok' | 'warn' | 'fail' | 'unconfigured';

export type HealthGroup = 'infrastructure' | 'storage' | 'email' | 'ai' | 'integrations' | 'endpoints';

export interface HealthCheckResult {
  id: string;
  group: HealthGroup;
  label: string;
  status: HealthStatus;
  /** Human-readable reason. Never contains a secret value. */
  detail: string;
  latencyMs: number;
}

export interface SystemHealthReport {
  status: Exclude<HealthStatus, 'unconfigured'>;
  /** Which process ran the checks; api and jobs can see different environments. */
  source: 'api' | 'jobs';
  checkedAt: string;
  durationMs: number;
  checks: HealthCheckResult[];
}

/** What a probe returns; the runner adds id, group, label and timing. */
export type ProbeOutcome = { status: HealthStatus; detail: string };

export interface HealthProbe {
  id: string;
  group: HealthGroup;
  label: string;
  run: () => Promise<ProbeOutcome>;
}

export interface HealthTransitions {
  newlyFailing: HealthCheckResult[];
  recovered: HealthCheckResult[];
}
