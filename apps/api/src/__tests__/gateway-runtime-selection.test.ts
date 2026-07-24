import { describe, expect, it } from 'vitest';
import { readGatewayConnectionFromEnv, selectGatewayModelId } from '@cio/core/services/agent/gateway-runtime';
import { DEFAULT_GATEWAY_SETTINGS, normalizeGatewaySettings } from '@cio/core/services/agent/gateway-settings';

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
    lightModelId: 'gpt-5.4-mini',
    ...overrides
  } as never);
}

describe('selectGatewayModelId', () => {
  it('serves the requested model when it is allowlisted', () => {
    expect(selectGatewayModelId(settings(), 'gpt-5.4-mini')).toBe('gpt-5.4-mini');
  });

  it('returns null for a model the gateway is not allowed to serve', () => {
    // Preserves the teacher's model choice rather than silently swapping it:
    // a Gemini request must go to Gemini, not to a Codex substitute.
    expect(selectGatewayModelId(settings(), 'gemini-2.5-flash-lite')).toBeNull();
  });

  it('returns null for a Claude model even though the proxy advertises one', () => {
    expect(selectGatewayModelId(settings(), 'claude-sonnet-4-6')).toBeNull();
  });

  it('returns null when the allowlist is empty', () => {
    expect(selectGatewayModelId(settings({ modelAllowlist: [] }), 'gpt-5.4')).toBeNull();
  });

  it('never substitutes a cheaper model to conserve quota', () => {
    // Output quality is never traded for capacity; the route may change, the model may not.
    expect(selectGatewayModelId(settings(), 'gpt-5.4')).toBe('gpt-5.4');
  });
});

describe('readGatewayConnectionFromEnv', () => {
  it('reads base url and token from the environment', () => {
    const connection = readGatewayConnectionFromEnv({
      AI_GATEWAY_BASE_URL: 'http://ccs:8317',
      AI_GATEWAY_AUTH_TOKEN: 'token-value'
    });

    expect(connection.baseURL).toBe('http://ccs:8317');
    expect(connection.authToken).toBe('token-value');
  });

  it('returns empty strings when unset so the resolver can fail closed', () => {
    const connection = readGatewayConnectionFromEnv({});

    expect(connection.baseURL).toBe('');
    expect(connection.authToken).toBe('');
  });

  it('trims surrounding whitespace from a pasted base url', () => {
    const connection = readGatewayConnectionFromEnv({
      AI_GATEWAY_BASE_URL: '  http://ccs:8317  ',
      AI_GATEWAY_AUTH_TOKEN: '  token  '
    });

    expect(connection.baseURL).toBe('http://ccs:8317');
    expect(connection.authToken).toBe('token');
  });
});
