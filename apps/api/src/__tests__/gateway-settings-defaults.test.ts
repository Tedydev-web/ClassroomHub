import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GATEWAY_SETTINGS,
  normalizeGatewaySettings,
  resolveOrgLimits,
  parseModelAllowlist,
  parseWindows,
  findAllowlistEntry
} from '@cio/core/services/agent/gateway-settings';

describe('normalizeGatewaySettings', () => {
  it('returns safe disabled defaults when no settings row exists', () => {
    const settings = normalizeGatewaySettings(null);

    expect(settings.enabled).toBe(false);
    expect(settings.pausedAt).toBeNull();
    expect(settings.circuitState).toBe('closed');
    expect(settings.modelAllowlist).toEqual([]);
  });

  it('never throws on a partially populated row', () => {
    expect(() => normalizeGatewaySettings({ enabled: true } as never)).not.toThrow();
  });

  it('keeps the gateway disabled when the row says so', () => {
    const settings = normalizeGatewaySettings({ ...DEFAULT_GATEWAY_SETTINGS, enabled: false } as never);

    expect(settings.enabled).toBe(false);
  });

  it('treats a row with a pause timestamp as paused', () => {
    const settings = normalizeGatewaySettings({
      ...DEFAULT_GATEWAY_SETTINGS,
      enabled: true,
      pausedAt: '2026-07-23T10:00:00.000Z',
      pauseReason: 'quota drill'
    } as never);

    expect(settings.pausedAt).not.toBeNull();
    expect(settings.pauseReason).toBe('quota drill');
  });

  it('falls back to a global concurrency of at least one', () => {
    const settings = normalizeGatewaySettings({ ...DEFAULT_GATEWAY_SETTINGS, globalConcurrency: 0 } as never);

    expect(settings.globalConcurrency).toBeGreaterThanOrEqual(1);
  });

  it('falls back to at least one slice round', () => {
    const settings = normalizeGatewaySettings({ ...DEFAULT_GATEWAY_SETTINGS, sliceRounds: 0 } as never);

    expect(settings.sliceRounds).toBeGreaterThanOrEqual(1);
  });
});

describe('resolveOrgLimits', () => {
  const settings = normalizeGatewaySettings({
    ...DEFAULT_GATEWAY_SETTINGS,
    defaultOrgActiveLimit: 1,
    defaultOrgQueuedLimit: 3,
    defaultOrgWindowBudgetUnits: 5_000
  } as never);

  it('inherits every global default when the org has no policy row', () => {
    const limits = resolveOrgLimits(settings, null);

    expect(limits.maxActiveRuns).toBe(1);
    expect(limits.maxQueuedRuns).toBe(3);
    expect(limits.windowBudgetUnits).toBe(5_000);
    expect(limits.priorityWeight).toBe(1);
    expect(limits.isBlocked).toBe(false);
  });

  it('overrides only the fields the org policy sets', () => {
    const limits = resolveOrgLimits(settings, {
      orgId: 'org-1',
      priorityWeight: 3,
      maxActiveRuns: 2,
      maxQueuedRuns: null,
      windowBudgetUnits: null,
      isBlocked: false,
      blockReason: null
    });

    expect(limits.maxActiveRuns).toBe(2);
    expect(limits.priorityWeight).toBe(3);
    // Unset fields still inherit.
    expect(limits.maxQueuedRuns).toBe(3);
    expect(limits.windowBudgetUnits).toBe(5_000);
  });

  it('carries the blocked flag and reason through', () => {
    const limits = resolveOrgLimits(settings, {
      orgId: 'org-1',
      priorityWeight: 1,
      maxActiveRuns: null,
      maxQueuedRuns: null,
      windowBudgetUnits: null,
      isBlocked: true,
      blockReason: 'abuse investigation'
    });

    expect(limits.isBlocked).toBe(true);
    expect(limits.blockReason).toBe('abuse investigation');
  });

  it('coerces a non-positive priority weight to one so virtual time never divides by zero', () => {
    const limits = resolveOrgLimits(settings, {
      orgId: 'org-1',
      priorityWeight: 0,
      maxActiveRuns: null,
      maxQueuedRuns: null,
      windowBudgetUnits: null,
      isBlocked: false,
      blockReason: null
    });

    expect(limits.priorityWeight).toBe(1);
  });
});

describe('parseWindows', () => {
  it('returns an empty list for malformed input rather than throwing', () => {
    expect(parseWindows(null)).toEqual([]);
    expect(parseWindows('not-json' as never)).toEqual([]);
  });

  it('preserves both windows in evaluation order', () => {
    const windows = parseWindows([
      { id: 'short', durationMinutes: 300, capUnits: 1_000 },
      { id: 'weekly', durationMinutes: 10_080, capUnits: 20_000 }
    ]);

    expect(windows).toHaveLength(2);
    expect(windows[0].id).toBe('short');
    expect(windows[1].id).toBe('weekly');
  });

  it('drops a window with a non-positive duration', () => {
    const windows = parseWindows([
      { id: 'bad', durationMinutes: 0, capUnits: 100 },
      { id: 'good', durationMinutes: 300, capUnits: 100 }
    ]);

    expect(windows.map((w) => w.id)).toEqual(['good']);
  });

  it('drops a window with a non-positive cap', () => {
    const windows = parseWindows([{ id: 'bad', durationMinutes: 300, capUnits: 0 }]);

    expect(windows).toEqual([]);
  });
});

describe('parseModelAllowlist', () => {
  it('returns an empty list for malformed input rather than throwing', () => {
    expect(parseModelAllowlist(null)).toEqual([]);
    expect(parseModelAllowlist('nope' as never)).toEqual([]);
  });

  it('rejects an entry with a non-positive quota weight', () => {
    const allowlist = parseModelAllowlist([
      { modelId: 'gpt-5.4', label: 'GPT-5.4', quotaWeight: 0, role: 'default' },
      { modelId: 'gpt-5.4-mini', label: 'Mini', quotaWeight: 1, role: 'light' }
    ]);

    expect(allowlist.map((entry) => entry.modelId)).toEqual(['gpt-5.4-mini']);
  });

  it('rejects an entry with a missing model id', () => {
    const allowlist = parseModelAllowlist([{ modelId: '', label: 'x', quotaWeight: 1, role: 'default' }]);

    expect(allowlist).toEqual([]);
  });

  it('finds an allowed model by id', () => {
    const allowlist = parseModelAllowlist([{ modelId: 'gpt-5.4', label: 'GPT-5.4', quotaWeight: 3, role: 'default' }]);

    expect(findAllowlistEntry(allowlist, 'gpt-5.4')?.quotaWeight).toBe(3);
  });

  it('returns undefined for a model outside the allowlist even if the proxy advertises it', () => {
    // The proxy's /v1/models advertises Claude models with no Claude auth configured,
    // so the allowlist is the only source of truth for what may be requested.
    const allowlist = parseModelAllowlist([{ modelId: 'gpt-5.4', label: 'GPT-5.4', quotaWeight: 3, role: 'default' }]);

    expect(findAllowlistEntry(allowlist, 'claude-sonnet-5')).toBeUndefined();
  });
});
