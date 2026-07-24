import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMoonshotAI } from '@ai-sdk/moonshotai';
import type { LanguageModel } from 'ai';
import { AIProvider } from '../types';
import {
  buildOfficialProviderConfig,
  normalizeGatewayBaseURL,
  resolveModelSpec,
  type AIProviderConfig
} from './transport';

export {
  assertValidTransport,
  buildGatewayProviderConfig,
  buildOfficialProviderConfig,
  normalizeGatewayBaseURL,
  DEFAULT_GATEWAY_CAPABILITIES,
  officialCapabilitiesFor,
  resolveModelSpec
} from './transport';

export type {
  AIModelCapabilities,
  AIModelEntrypoint,
  AIProviderConfig,
  AITransport,
  ResolvedModelSpec
} from './transport';

const DEFAULT_MODELS: Record<AIProvider, string> = {
  [AIProvider.OPENAI]: 'gpt-5.4-mini',
  [AIProvider.ANTHROPIC]: 'claude-sonnet-4-20250514',
  [AIProvider.GOOGLE]: 'gemini-2.5-flash-lite',
  [AIProvider.MOONSHOT]: 'kimi-k2.6'
};

const PROVIDER_API_KEY_ENV: Record<AIProvider, string> = {
  [AIProvider.OPENAI]: 'OPENAI_API_KEY',
  [AIProvider.ANTHROPIC]: 'ANTHROPIC_API_KEY',
  [AIProvider.GOOGLE]: 'GOOGLE_API_KEY',
  [AIProvider.MOONSHOT]: 'MOONSHOT_API_KEY'
};

/**
 * Creates an AI SDK LanguageModel from provider configuration.
 *
 * Official transports use each vendor's own SDK. Gateway transports build an
 * OpenAI client pointed at the proxy and must use the chat-completions
 * entrypoint — the SDK's default OpenAI entrypoint targets `/v1/responses`,
 * which CLIProxy does not implement.
 */
export function createModel(config: AIProviderConfig): LanguageModel {
  const spec = resolveModelSpec(config);

  if (spec.kind === 'gateway') {
    const gateway = createOpenAI({
      // The SDK appends only the endpoint path, so the base must already point
      // at the versioned root or every call 404s.
      baseURL: normalizeGatewayBaseURL(spec.baseURL ?? ''),
      // The proxy authenticates with a bearer token in the same header slot the
      // SDK uses for an API key.
      apiKey: config.transport.kind === 'gateway' ? config.transport.authToken : ''
    });

    return gateway.chat(spec.modelId);
  }

  const apiKey = config.transport.kind === 'official' ? config.transport.apiKey : '';

  switch (spec.provider) {
    case AIProvider.OPENAI: {
      const openai = createOpenAI({ apiKey });
      return openai(spec.modelId);
    }
    case AIProvider.ANTHROPIC: {
      const anthropic = createAnthropic({ apiKey });
      return anthropic(spec.modelId);
    }
    case AIProvider.GOOGLE: {
      const google = createGoogleGenerativeAI({ apiKey });
      return google(spec.modelId);
    }
    case AIProvider.MOONSHOT: {
      const moonshot = createMoonshotAI({ apiKey });
      return moonshot(spec.modelId);
    }
    default:
      throw new Error(`Unsupported AI provider: ${spec.provider}`);
  }
}

/**
 * Reads the API key for a specific provider from its dedicated env var.
 * Returns null when the key is unset, so callers can decide whether to 503.
 */
export function getProviderConfigForProvider(provider: AIProvider): AIProviderConfig | null {
  const apiKey = process.env[PROVIDER_API_KEY_ENV[provider]];
  if (!apiKey) return null;

  return buildOfficialProviderConfig(provider, apiKey, DEFAULT_MODELS[provider]);
}

/**
 * Returns the first provider that has a key configured, in preference order.
 * Used by routes that don't take an explicit model (status check, title generation).
 */
export function pickAnyConfiguredProvider(): AIProviderConfig | null {
  const order: AIProvider[] = [AIProvider.GOOGLE, AIProvider.OPENAI, AIProvider.ANTHROPIC];

  for (const provider of order) {
    const config = getProviderConfigForProvider(provider);
    if (config) return config;
  }

  return null;
}
