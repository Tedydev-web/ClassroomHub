import { pickAnyConfiguredProvider, type AIProviderConfig } from '@cio/ai-assistant/providers';
import { resolveAgentGatewayTransport } from '@cio/core/services/agent/gateway-runtime';
import { getGatewaySettings } from '@cio/core/services/agent/gateway-settings-store';

/**
 * Transport for the short utility calls that have no model picker: conversation
 * titles, course titles, and field text.
 *
 * These asked `pickAnyConfiguredProvider()` alone, which reads provider API keys
 * from the environment. A deployment running purely on the shared subscription
 * has no such keys, so every one of those calls answered 503 while chat — which
 * consults the gateway — kept working.
 *
 * The light model is requested because these are one-shot, low-value generations;
 * the gateway only serves what its allowlist carries, so an unlisted light model
 * falls back to the official provider rather than being substituted.
 */
export async function resolveUtilityProviderConfig(): Promise<AIProviderConfig | null> {
  const officialProviderConfig = pickAnyConfiguredProvider();
  const settings = await getGatewaySettings();
  const requestedModelId = settings.lightModelId ?? settings.defaultModelId;

  if (!requestedModelId) {
    return officialProviderConfig;
  }

  // Interactive: somebody is waiting on this response, so a busy gateway falls
  // back to the official provider instead of queueing the request.
  const { gatewayConfig } = await resolveAgentGatewayTransport({
    requestedModelId,
    workload: 'interactive',
    hasOfficialKey: officialProviderConfig !== null
  });

  return gatewayConfig ?? officialProviderConfig;
}
