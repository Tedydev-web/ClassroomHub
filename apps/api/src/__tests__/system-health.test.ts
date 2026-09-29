import { afterEach, describe, expect, it, vi } from 'vitest';

import { getCredentialProbes, outcomeFromHttpStatus } from '@cio/core/services/system-health/credential-probes';
import {
  runHealthProbes,
  runProbe,
  summarizeHealthStatus
} from '@cio/core/services/system-health/health-report-runner';
import { diffHealthReports } from '@cio/core/services/system-health/index';
import type { HealthCheckResult, SystemHealthReport } from '@cio/core/services/system-health/types';

function check(id: string, status: HealthCheckResult['status']): HealthCheckResult {
  return { id, group: 'infrastructure', label: id, status, detail: '', latencyMs: 0 };
}

function report(checks: HealthCheckResult[]): SystemHealthReport {
  return { status: summarizeHealthStatus(checks), source: 'jobs', checkedAt: '', durationMs: 0, checks };
}

describe('health report runner', () => {
  it('turns a thrown probe into a failed check instead of a failed report', async () => {
    const result = await runProbe({
      id: 'x',
      group: 'infrastructure',
      label: 'X',
      run: async () => {
        throw new Error('connection refused');
      }
    });

    expect(result).toMatchObject({ id: 'x', status: 'fail', detail: 'connection refused' });
  });

  it('fails a probe that outlives its timeout without holding the report', async () => {
    const hung = { id: 'hung', group: 'ai' as const, label: 'Hung', run: () => new Promise<never>(() => {}) };
    const quick = {
      id: 'quick',
      group: 'ai' as const,
      label: 'Quick',
      run: async () => ({ status: 'ok' as const, detail: '' })
    };

    const result = await runHealthProbes([hung, quick], 'api', 20);

    expect(result.checks.find((c) => c.id === 'hung')).toMatchObject({
      status: 'fail',
      detail: 'Timed out after 20ms'
    });
    expect(result.checks.find((c) => c.id === 'quick')?.status).toBe('ok');
    expect(result.status).toBe('fail');
  });

  it('never lets an unconfigured integration raise the overall status', () => {
    expect(summarizeHealthStatus([check('a', 'ok'), check('b', 'unconfigured')])).toBe('ok');
    expect(summarizeHealthStatus([check('a', 'warn'), check('b', 'unconfigured')])).toBe('warn');
    expect(summarizeHealthStatus([check('a', 'warn'), check('b', 'fail')])).toBe('fail');
  });
});

describe('health transitions', () => {
  it('announces only checks that started or stopped failing', () => {
    const previous = report([check('db', 'fail'), check('smtp', 'ok'), check('redis', 'fail')]);
    const current = report([check('db', 'fail'), check('smtp', 'fail'), check('redis', 'ok')]);

    const transitions = diffHealthReports(previous, current);

    expect(transitions.newlyFailing.map((c) => c.id)).toEqual(['smtp']);
    expect(transitions.recovered.map((c) => c.id)).toEqual(['redis']);
  });

  it('announces every current failure when there is no previous report', () => {
    const transitions = diffHealthReports(null, report([check('db', 'fail'), check('smtp', 'warn')]));

    expect(transitions.newlyFailing.map((c) => c.id)).toEqual(['db']);
    expect(transitions.recovered).toEqual([]);
  });
});

describe('credential probes', () => {
  const secret = 'sk-health-test-secret-value';

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('maps provider answers onto check outcomes', () => {
    expect(outcomeFromHttpStatus(200, 'Key accepted').status).toBe('ok');
    expect(outcomeFromHttpStatus(401, '').status).toBe('fail');
    expect(outcomeFromHttpStatus(429, '').status).toBe('warn');
    expect(outcomeFromHttpStatus(503, '').status).toBe('fail');
  });

  it('reports a rejected key without echoing it', async () => {
    vi.stubEnv('OPENAI_API_KEY', secret);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"invalid key"}', { status: 401 }))
    );

    const probe = getCredentialProbes().find((p) => p.id === 'ai-openai');
    const result = await runProbe(probe!);

    expect(result.status).toBe('fail');
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('flags a rendering token whose account id is missing', async () => {
    vi.stubEnv('CLOUDFLARE_RENDERING_API_KEY', secret);
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', '');

    const probe = getCredentialProbes().find((p) => p.id === 'cloudflare-rendering');
    const result = await runProbe(probe!);

    expect(result).toMatchObject({ status: 'fail', detail: 'CLOUDFLARE_ACCOUNT_ID is missing; rendering cannot run' });
  });

  it('treats an unset key as unconfigured rather than failing', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');

    const probe = getCredentialProbes().find((p) => p.id === 'ai-anthropic');

    expect((await runProbe(probe!)).status).toBe('unconfigured');
  });
});
