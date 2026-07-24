import { describe, expect, it } from 'vitest';
import { resolveGatewayRoute } from '@cio/core/services/agent/gateway-transport-resolver';
import { DEFAULT_GATEWAY_SETTINGS, normalizeGatewaySettings } from '@cio/core/services/agent/gateway-settings';

const NOW = Date.parse('2026-07-23T10:00:00.000Z');

const ALLOWLIST = [
  { modelId: 'gpt-5.4', label: 'GPT-5.4', quotaWeight: 3, role: 'default' as const },
  { modelId: 'gpt-5.4-mini', label: 'Mini', quotaWeight: 1, role: 'light' as const }
];

function settings(overrides: Partial<typeof DEFAULT_GATEWAY_SETTINGS> = {}) {
  return normalizeGatewaySettings({
    ...DEFAULT_GATEWAY_SETTINGS,
    enabled: true,
    modelAllowlist: ALLOWLIST,
    defaultModelId: 'gpt-5.4',
    ...overrides
  } as never);
}

const GATEWAY_CONNECTION = { baseURL: 'http://ccs:8317', authToken: 'token' };

describe('resolveGatewayRoute', () => {
  it('routes to the gateway when everything is healthy', () => {
    const route = resolveGatewayRoute({
      settings: settings(),
      connection: GATEWAY_CONNECTION,
      hasOfficialKey: true,
      model: 'gpt-5.4',
      workload: 'interactive',
      gatewaySlotBusy: false,
      now: NOW
    });

    expect(route.decision).toBe('gateway');
  });

  it('falls back to the official api when the gateway is disabled', () => {
    const route = resolveGatewayRoute({
      settings: settings({ enabled: false }),
      connection: GATEWAY_CONNECTION,
      hasOfficialKey: true,
      model: 'gpt-5.4',
      workload: 'interactive',
      gatewaySlotBusy: false,
      now: NOW
    });

    expect(route.decision).toBe('official');
  });

  it('falls back to the official api when the gateway is paused and carries the reason', () => {
    const route = resolveGatewayRoute({
      settings: settings({ pausedAt: '2026-07-23T09:00:00.000Z', pauseReason: 'quota drill' }),
      connection: GATEWAY_CONNECTION,
      hasOfficialKey: true,
      model: 'gpt-5.4',
      workload: 'interactive',
      gatewaySlotBusy: false,
      now: NOW
    });

    expect(route.decision).toBe('official');
    expect(route.reason).toBe('gateway_paused');
    expect(route.detail).toContain('quota drill');
  });

  it('falls back to the official api while the breaker is open', () => {
    const route = resolveGatewayRoute({
      settings: settings({
        circuitState: 'open',
        circuitResumeAfter: new Date(NOW + 60_000).toISOString(),
        consecutiveFailures: 1
      }),
      connection: GATEWAY_CONNECTION,
      hasOfficialKey: true,
      model: 'gpt-5.4',
      workload: 'batch',
      gatewaySlotBusy: false,
      now: NOW
    });

    expect(route.decision).toBe('official');
    expect(route.reason).toBe('circuit_open');
  });

  it('sends interactive traffic to the official api rather than making a user wait for a busy slot', () => {
    const route = resolveGatewayRoute({
      settings: settings(),
      connection: GATEWAY_CONNECTION,
      hasOfficialKey: true,
      model: 'gpt-5.4',
      workload: 'interactive',
      gatewaySlotBusy: true,
      now: NOW
    });

    expect(route.decision).toBe('official');
    expect(route.reason).toBe('gateway_busy');
  });

  it('queues batch traffic instead of paying for the official api when the slot is busy', () => {
    const route = resolveGatewayRoute({
      settings: settings(),
      connection: GATEWAY_CONNECTION,
      hasOfficialKey: true,
      model: 'gpt-5.4',
      workload: 'batch',
      gatewaySlotBusy: true,
      now: NOW
    });

    expect(route.decision).toBe('queue');
  });

  it('reports unavailable when the gateway is down and fallback is disabled', () => {
    const route = resolveGatewayRoute({
      settings: settings({ enabled: false, fallbackEnabled: false }),
      connection: GATEWAY_CONNECTION,
      hasOfficialKey: true,
      model: 'gpt-5.4',
      workload: 'interactive',
      gatewaySlotBusy: false,
      now: NOW
    });

    expect(route.decision).toBe('unavailable');
  });

  it('serves a subscription-only deployment that has no official key at all', () => {
    // The headline configuration: one subscription, zero provider keys. An
    // implementation that demands an official key before consulting the gateway
    // would reject every request here.
    const route = resolveGatewayRoute({
      settings: settings(),
      connection: GATEWAY_CONNECTION,
      hasOfficialKey: false,
      model: 'gpt-5.4',
      workload: 'interactive',
      gatewaySlotBusy: false,
      now: NOW
    });

    expect(route.decision).toBe('gateway');
  });

  it('reports unavailable when the gateway is down and no official key is configured', () => {
    const route = resolveGatewayRoute({
      settings: settings({ enabled: false }),
      connection: GATEWAY_CONNECTION,
      hasOfficialKey: false,
      model: 'gpt-5.4',
      workload: 'interactive',
      gatewaySlotBusy: false,
      now: NOW
    });

    expect(route.decision).toBe('unavailable');
  });

  it('refuses fallback once the monthly spend cap is exceeded', () => {
    // The self-owned deployment bypasses enforceTokenBalance, so this cap is the
    // only thing standing between a runaway loop and an unbounded API bill.
    const route = resolveGatewayRoute({
      settings: settings({ enabled: false, fallbackMonthlyCapUnits: 1_000 }),
      connection: GATEWAY_CONNECTION,
      hasOfficialKey: true,
      model: 'gpt-5.4',
      workload: 'interactive',
      gatewaySlotBusy: false,
      fallbackMonthlyUnitsUsed: 1_500,
      now: NOW
    });

    expect(route.decision).toBe('unavailable');
    expect(route.reason).toBe('fallback_cap_exceeded');
  });

  it('still allows fallback while under the monthly spend cap', () => {
    const route = resolveGatewayRoute({
      settings: settings({ enabled: false, fallbackMonthlyCapUnits: 1_000 }),
      connection: GATEWAY_CONNECTION,
      hasOfficialKey: true,
      model: 'gpt-5.4',
      workload: 'interactive',
      gatewaySlotBusy: false,
      fallbackMonthlyUnitsUsed: 100,
      now: NOW
    });

    expect(route.decision).toBe('official');
  });

  it('never routes a model outside the allowlist to the gateway', () => {
    // /v1/models advertises Claude even with no Claude auth; the allowlist is the
    // only source of truth for what may be requested.
    const route = resolveGatewayRoute({
      settings: settings(),
      connection: GATEWAY_CONNECTION,
      hasOfficialKey: true,
      model: 'claude-sonnet-5',
      workload: 'interactive',
      gatewaySlotBusy: false,
      now: NOW
    });

    expect(route.decision).not.toBe('gateway');
    expect(route.reason).toBe('model_not_allowed');
  });

  it('falls back when gateway connection details are missing', () => {
    const route = resolveGatewayRoute({
      settings: settings(),
      connection: { baseURL: '', authToken: '' },
      hasOfficialKey: true,
      model: 'gpt-5.4',
      workload: 'interactive',
      gatewaySlotBusy: false,
      now: NOW
    });

    expect(route.decision).toBe('official');
    expect(route.reason).toBe('gateway_unconfigured');
  });

  it('marks the call as a probe when the breaker cooldown has elapsed', () => {
    const route = resolveGatewayRoute({
      settings: settings({
        circuitState: 'open',
        circuitResumeAfter: new Date(NOW - 1_000).toISOString(),
        consecutiveFailures: 1
      }),
      connection: GATEWAY_CONNECTION,
      hasOfficialKey: true,
      model: 'gpt-5.4',
      workload: 'batch',
      gatewaySlotBusy: false,
      now: NOW
    });

    expect(route.decision).toBe('gateway');
    expect(route.isProbe).toBe(true);
  });
});
