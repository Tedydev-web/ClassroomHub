import { AIProvider } from '../types';

/**
 * How a model call physically reaches a provider.
 *
 * - `official` targets a vendor SDK against its own endpoint.
 * - `gateway` targets an OpenAI-compatible proxy (CCS/CLIProxy) that fronts a
 *   subscription-backed upstream.
 *
 * The distinction matters because a gateway speaks the OpenAI wire format but
 * does not necessarily support every feature of the vendor it fronts.
 */
export type AITransport =
  | { kind: 'official'; provider: AIProvider; apiKey: string }
  | { kind: 'gateway'; protocol: 'openai-chat'; baseURL: string; authToken: string };

/**
 * What a given transport + model combination can actually do.
 *
 * Behavior is gated on these flags rather than on the provider name, because a
 * gateway fronting OpenAI is not feature-equivalent to calling OpenAI directly.
 */
export interface AIModelCapabilities {
  streaming: boolean;
  toolCalling: boolean;
  structuredOutput: boolean;
  /** Anthropic-style explicit prompt caching. Unverified through the gateway. */
  promptCaching: boolean;
  imageInput: boolean;
  /** Whether the transport reliably returns prompt/completion token counts. */
  usageReporting: boolean;
}

export interface AIProviderConfig {
  transport: AITransport;
  /**
   * Provider family this config targets. For gateway transports this is the
   * protocol family (OpenAI), not the subscription vendor.
   */
  provider: AIProvider;
  model: string;
  capabilities: AIModelCapabilities;
}

/** Which SDK entrypoint a resolved spec must use. */
export type AIModelEntrypoint = 'default' | 'chat';

/**
 * Normalizes a gateway base URL to the versioned root the AI SDK expects.
 *
 * Operators configure the plain host (`http://ccs:8317`), but the SDK appends
 * only the endpoint path — so without `/v1` every request 404s. Accepting both
 * forms avoids an error whose message ("Not Found") says nothing about the cause.
 */
export function normalizeGatewayBaseURL(baseURL: string): string {
  const trimmed = baseURL.replace(/\/+$/, '');

  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

export interface ResolvedModelSpec {
  kind: AITransport['kind'];
  provider: AIProvider;
  modelId: string;
  baseURL?: string;
  entrypoint: AIModelEntrypoint;
}

/**
 * Capabilities verified live against CLIProxy on 2026-07-23.
 *
 * Streaming, tool calling, and complete `usage` objects were confirmed with real
 * requests. Prompt caching stays off: the proxy's cache semantics are unverified,
 * and assuming them would silently corrupt cache accounting.
 */
export const DEFAULT_GATEWAY_CAPABILITIES: AIModelCapabilities = {
  streaming: true,
  toolCalling: true,
  structuredOutput: true,
  promptCaching: false,
  imageInput: true,
  usageReporting: true
};

const OFFICIAL_CAPABILITIES: Record<AIProvider, AIModelCapabilities> = {
  [AIProvider.OPENAI]: {
    streaming: true,
    toolCalling: true,
    structuredOutput: true,
    promptCaching: false,
    imageInput: true,
    usageReporting: true
  },
  [AIProvider.ANTHROPIC]: {
    streaming: true,
    toolCalling: true,
    structuredOutput: true,
    promptCaching: true,
    imageInput: true,
    usageReporting: true
  },
  [AIProvider.GOOGLE]: {
    streaming: true,
    toolCalling: true,
    structuredOutput: true,
    promptCaching: false,
    imageInput: true,
    usageReporting: true
  },
  [AIProvider.MOONSHOT]: {
    streaming: true,
    toolCalling: true,
    structuredOutput: true,
    promptCaching: false,
    imageInput: false,
    usageReporting: true
  }
};

/**
 * Validates a transport before it is used to build a client.
 *
 * Fails closed: an incomplete transport throws rather than silently degrading to
 * a different route, which would send traffic somewhere the caller did not
 * intend. Error messages deliberately name only the missing field — never the
 * credential value — so they stay safe to log.
 */
export function assertValidTransport(transport: AITransport): void {
  if (transport.kind === 'official') {
    if (!transport.apiKey) {
      throw new Error(`Missing API key for provider "${transport.provider}"`);
    }

    return;
  }

  if (!transport.baseURL) {
    throw new Error('Missing gateway base URL');
  }

  if (!transport.authToken) {
    throw new Error('Missing gateway auth token');
  }
}

/**
 * Reduces a provider config to the concrete facts needed to build an SDK client.
 *
 * Gateway transports always resolve to the chat-completions entrypoint: CLIProxy
 * implements `/v1/chat/completions`, while the AI SDK's default OpenAI entrypoint
 * targets `/v1/responses`, which the proxy does not serve.
 */
export function resolveModelSpec(config: AIProviderConfig): ResolvedModelSpec {
  assertValidTransport(config.transport);

  if (config.transport.kind === 'official') {
    return {
      kind: 'official',
      provider: config.transport.provider,
      modelId: config.model,
      entrypoint: 'default'
    };
  }

  return {
    kind: 'gateway',
    provider: AIProvider.OPENAI,
    modelId: config.model,
    baseURL: config.transport.baseURL,
    entrypoint: 'chat'
  };
}

/** Builds a config for a vendor's own endpoint. */
export function buildOfficialProviderConfig(
  provider: AIProvider,
  apiKey: string,
  model: string,
  capabilities?: Partial<AIModelCapabilities>
): AIProviderConfig {
  return {
    transport: { kind: 'official', provider, apiKey },
    provider,
    model,
    capabilities: { ...OFFICIAL_CAPABILITIES[provider], ...capabilities }
  };
}

/** Builds a config for the OpenAI-compatible subscription gateway. */
export function buildGatewayProviderConfig(params: {
  baseURL: string;
  authToken: string;
  model: string;
  capabilities?: Partial<AIModelCapabilities>;
}): AIProviderConfig {
  return {
    transport: {
      kind: 'gateway',
      protocol: 'openai-chat',
      baseURL: params.baseURL,
      authToken: params.authToken
    },
    provider: AIProvider.OPENAI,
    model: params.model,
    capabilities: { ...DEFAULT_GATEWAY_CAPABILITIES, ...params.capabilities }
  };
}

/** Capability defaults for a vendor's own endpoint, used when composing configs. */
export function officialCapabilitiesFor(provider: AIProvider): AIModelCapabilities {
  return { ...OFFICIAL_CAPABILITIES[provider] };
}
