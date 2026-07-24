import { describe, expect, it } from 'vitest';
import {
  AGENT_MODELS,
  AGENT_MODEL_IDS,
  DEFAULT_FALLBACK_MODEL_ID,
  DEFAULT_PICKER_MODEL_ID,
  FALLBACK_MODEL_IDS,
  GATEWAY_MODEL_IDS,
  UI_PICKER_MODEL_IDS,
  getPickerModelIds
} from '@cio/utils/agent-models';

describe('agent model registry', () => {
  it('offers only Codex models while the gateway is serving', () => {
    // The point of the shared subscription is that normal traffic runs on it.
    // Listing a non-gateway model during normal operation would quietly route
    // work around the subscription the platform pays for.
    const offered = getPickerModelIds({ gatewayActive: true });

    expect(offered.length).toBeGreaterThan(0);
    for (const id of offered) {
      expect(AGENT_MODELS[id].route).toBe('gateway');
      expect(AGENT_MODELS[id].provider).toBe('openai');
    }
  });

  it('offers the official-API fallback only when the gateway is down', () => {
    const offered = getPickerModelIds({ gatewayActive: false });

    expect(offered.length).toBeGreaterThan(0);
    for (const id of offered) {
      expect(AGENT_MODELS[id].route).toBe('fallback');
    }
  });

  it('never offers a gateway model while the gateway is down', () => {
    const offered = getPickerModelIds({ gatewayActive: false });

    expect(offered.some((id) => AGENT_MODELS[id].route === 'gateway')).toBe(false);
  });

  it('never offers a fallback model while the gateway is up', () => {
    const offered = getPickerModelIds({ gatewayActive: true });

    expect(offered.some((id) => AGENT_MODELS[id].route === 'fallback')).toBe(false);
  });

  it('defaults to a gateway model', () => {
    expect(AGENT_MODELS[DEFAULT_PICKER_MODEL_ID].route).toBe('gateway');
    expect(GATEWAY_MODEL_IDS).toContain(DEFAULT_PICKER_MODEL_ID);
  });

  it('keeps the default free so a free-plan teacher is not gated on first use', () => {
    expect(AGENT_MODELS[DEFAULT_PICKER_MODEL_ID].isFree).toBe(true);
  });

  it('defaults to a fallback model when the gateway is down', () => {
    expect(AGENT_MODELS[DEFAULT_FALLBACK_MODEL_ID].route).toBe('fallback');
    expect(FALLBACK_MODEL_IDS).toContain(DEFAULT_FALLBACK_MODEL_ID);
  });

  it('keeps the fallback default free as well', () => {
    expect(AGENT_MODELS[DEFAULT_FALLBACK_MODEL_ID].isFree).toBe(true);
  });

  it('never offers legacy models in either state', () => {
    // Legacy ids exist so an id stored in an old conversation still resolves;
    // they must never be presented as a choice.
    const legacy = AGENT_MODEL_IDS.filter((id) => AGENT_MODELS[id].route === 'legacy');

    expect(legacy.length).toBeGreaterThan(0);
    for (const id of legacy) {
      expect(getPickerModelIds({ gatewayActive: true })).not.toContain(id);
      expect(getPickerModelIds({ gatewayActive: false })).not.toContain(id);
      expect(UI_PICKER_MODEL_IDS).not.toContain(id);
    }
  });

  it('resolves every registered id to a descriptor', () => {
    for (const id of AGENT_MODEL_IDS) {
      expect(AGENT_MODELS[id]).toBeDefined();
      expect(AGENT_MODELS[id].backendModelId.length).toBeGreaterThan(0);
    }
  });

  it('covers both routes in the plan-gating list', () => {
    // Gating must consider every model a teacher could end up on, not just the
    // ones currently offered.
    for (const id of [...GATEWAY_MODEL_IDS, ...FALLBACK_MODEL_IDS]) {
      expect(UI_PICKER_MODEL_IDS).toContain(id);
    }
  });

  it('lists only backend model ids the gateway was verified to serve', () => {
    // Probed live on 2026-07-23. gpt-5.3-codex and gpt-5.2 appear in the proxy
    // catalog but answer "unknown provider", so they must not be offered.
    const verified = new Set(['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol']);

    for (const id of GATEWAY_MODEL_IDS) {
      expect(verified).toContain(AGENT_MODELS[id].backendModelId);
    }
  });
});
