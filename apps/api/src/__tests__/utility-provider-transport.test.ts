import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GATEWAY_SETTINGS } from '@cio/core/services/agent/gateway-settings';

const getGatewaySettings = vi.fn();

vi.mock('@cio/core/services/agent/gateway-settings-store', () => ({
  getGatewaySettings: (...args: unknown[]) => getGatewaySettings(...args),
  invalidateGatewaySettingsCache: () => {}
}));

const LIGHT_MODEL = 'claude-haiku-4-5-20251001';
const repoRoot = join(import.meta.dirname, '../../../..');

/**
 * Regression: the utility routes must serve a deployment that has no provider
 * API keys at all.
 *
 * Conversation titles, course titles and field text asked only for an official
 * provider key. On a deployment running purely on the shared subscription there
 * is none, so all three answered 503 while chat — which consults the gateway —
 * kept working.
 */
describe('resolveUtilityProviderConfig', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.MOONSHOT_API_KEY;
    process.env.AI_GATEWAY_BASE_URL = 'http://ccs:8317';
    process.env.AI_GATEWAY_AUTH_TOKEN = 'gateway-token-value';

    getGatewaySettings.mockResolvedValue({
      ...DEFAULT_GATEWAY_SETTINGS,
      enabled: true,
      lightModelId: LIGHT_MODEL,
      defaultModelId: 'claude-sonnet-5',
      modelAllowlist: [{ role: 'light', label: 'Light', modelId: LIGHT_MODEL, quotaWeight: 0.3 }]
    });
  });

  it('serves through the gateway when no provider key is configured', async () => {
    const { resolveUtilityProviderConfig } = await import('../services/agent/utility-provider');
    const config = await resolveUtilityProviderConfig();

    expect(config?.transport.kind).toBe('gateway');
    expect(config?.model).toBe(LIGHT_MODEL);
  });

  it('reports nothing configured when the gateway is off and no key exists', async () => {
    getGatewaySettings.mockResolvedValue({ ...DEFAULT_GATEWAY_SETTINGS, enabled: false });

    const { resolveUtilityProviderConfig } = await import('../services/agent/utility-provider');

    expect(await resolveUtilityProviderConfig()).toBeNull();
  });
});

/**
 * The cheap-model tables in these two services name vendor models. Applying one
 * to a gateway config asks the subscription for a model its allowlist does not
 * carry, which it refuses — so the swap must be reachable only for an official
 * provider.
 */
describe('the cheap-model swap', () => {
  for (const relative of [
    'apps/api/src/services/agent/title-generation.ts',
    'apps/api/src/services/agent/text-generation.ts'
  ]) {
    it(`${relative} leaves a gateway config's model alone`, () => {
      const source = readFileSync(join(repoRoot, relative), 'utf8');

      expect(source).toMatch(/transport\.kind === 'gateway'/);
    });
  }
});
