import { describe, expect, it } from 'vitest';
import { DEFAULT_GATEWAY_SETTINGS, normalizeGatewaySettings } from '@cio/core/services/agent/gateway-settings';
import { resolveDefaultPickerModelId, resolvePickerModels } from '@cio/core/services/agent/picker-models';

/**
 * The gateway allowlist (DB, super-admin managed) is the single source of
 * truth for the chat model picker — these tests pin the exact contract other
 * phases build on: visible-by-default, an explicit `visible: false` hides a
 * model, and an allowlist entry with no matching registry descriptor is
 * skipped rather than crashing the picker.
 */
describe('resolvePickerModels', () => {
  it('offers a visible allowlist entry, joined against the registry for provider/cost metadata', () => {
    const settings = normalizeGatewaySettings({
      ...DEFAULT_GATEWAY_SETTINGS,
      modelAllowlist: [{ modelId: 'claude-sonnet-5', label: 'Claude', quotaWeight: 1, role: 'default' }]
    } as never);

    const models = resolvePickerModels(settings);

    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ id: 'claude-sonnet-5', label: 'Claude', provider: 'anthropic' });
  });

  it('hides an entry explicitly marked visible: false', () => {
    const settings = normalizeGatewaySettings({
      ...DEFAULT_GATEWAY_SETTINGS,
      modelAllowlist: [{ modelId: 'claude-sonnet-5', label: 'Claude', quotaWeight: 1, role: 'default', visible: false }]
    } as never);

    expect(resolvePickerModels(settings)).toEqual([]);
  });

  it('treats an entry with no visible flag as visible (default true)', () => {
    const settings = normalizeGatewaySettings({
      ...DEFAULT_GATEWAY_SETTINGS,
      modelAllowlist: [{ modelId: 'claude-sonnet-5', label: 'Claude', quotaWeight: 1, role: 'default' }]
    } as never);

    expect(resolvePickerModels(settings)).toHaveLength(1);
  });

  it('skips an allowlist entry whose modelId has no registry descriptor instead of throwing', () => {
    const settings = normalizeGatewaySettings({
      ...DEFAULT_GATEWAY_SETTINGS,
      modelAllowlist: [
        { modelId: 'some-unknown-model', label: 'Unknown', quotaWeight: 1, role: 'optional' },
        { modelId: 'gpt-5.4', label: 'GPT-5.4', quotaWeight: 1, role: 'default' }
      ]
    } as never);

    expect(() => resolvePickerModels(settings)).not.toThrow();
    expect(resolvePickerModels(settings).map((m) => m.id)).toEqual(['gpt-5.4']);
  });

  it('preserves allowlist order', () => {
    const settings = normalizeGatewaySettings({
      ...DEFAULT_GATEWAY_SETTINGS,
      modelAllowlist: [
        { modelId: 'gpt-5.6-luna', label: 'Luna', quotaWeight: 3, role: 'optional' },
        { modelId: 'gpt-5.4-mini', label: 'Mini', quotaWeight: 1, role: 'light' }
      ]
    } as never);

    expect(resolvePickerModels(settings).map((m) => m.id)).toEqual(['gpt-5.6-luna', 'gpt-5.4-mini']);
  });
});

describe('resolveDefaultPickerModelId', () => {
  const pickerModels = [{ id: 'gpt-5.4' }, { id: 'gpt-5.4-mini' }];

  it('uses the preferred id when it is actually offered', () => {
    expect(resolveDefaultPickerModelId(pickerModels, 'gpt-5.4-mini', 'gpt-5.4')).toBe('gpt-5.4-mini');
  });

  it('falls back to the first offered model when the preferred id is not offered', () => {
    expect(resolveDefaultPickerModelId(pickerModels, 'claude-sonnet-5', 'gpt-5.4')).toBe('gpt-5.4');
  });

  it('falls back to the first offered model when no preferred id is set', () => {
    expect(resolveDefaultPickerModelId(pickerModels, null, 'gpt-5.4')).toBe('gpt-5.4');
  });

  it('falls back to the caller fallback constant when the picker list is empty', () => {
    expect(resolveDefaultPickerModelId([], 'gpt-5.4-mini', 'gpt-5.4')).toBe('gpt-5.4');
  });
});
