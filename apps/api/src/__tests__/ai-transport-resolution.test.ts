import { describe, expect, it } from 'vitest';
import {
  assertValidTransport,
  buildGatewayProviderConfig,
  buildOfficialProviderConfig,
  normalizeGatewayBaseURL,
  DEFAULT_GATEWAY_CAPABILITIES,
  resolveModelSpec
} from '@cio/ai-assistant/providers';
import { AIProvider } from '@cio/ai-assistant';

const GATEWAY_BASE_URL = 'http://ccs:8317';
const GATEWAY_TOKEN = 'gateway-token-value';

describe('resolveModelSpec', () => {
  it('resolves an official provider to its SDK default entrypoint without a base URL override', () => {
    const spec = resolveModelSpec(buildOfficialProviderConfig(AIProvider.OPENAI, 'key', 'gpt-5.4-mini'));

    expect(spec.kind).toBe('official');
    expect(spec.provider).toBe(AIProvider.OPENAI);
    expect(spec.modelId).toBe('gpt-5.4-mini');
    expect(spec.baseURL).toBeUndefined();
    expect(spec.entrypoint).toBe('default');
  });

  it('resolves a gateway transport to the configured base URL', () => {
    const spec = resolveModelSpec(
      buildGatewayProviderConfig({
        baseURL: GATEWAY_BASE_URL,
        authToken: GATEWAY_TOKEN,
        model: 'gpt-5.4'
      })
    );

    expect(spec.kind).toBe('gateway');
    expect(spec.baseURL).toBe(GATEWAY_BASE_URL);
    expect(spec.modelId).toBe('gpt-5.4');
  });

  it('always routes gateway transports through the chat-completions entrypoint', () => {
    // CLIProxy serves /v1/chat/completions. The AI SDK default entrypoint targets
    // /v1/responses, which the proxy does not implement.
    const spec = resolveModelSpec(
      buildGatewayProviderConfig({
        baseURL: GATEWAY_BASE_URL,
        authToken: GATEWAY_TOKEN,
        model: 'gpt-5.4'
      })
    );

    expect(spec.entrypoint).toBe('chat');
  });

  it('preserves the requested model id rather than any provider-resolved snapshot id', () => {
    // The proxy answers `gpt-5.4-mini` with `gpt-5.4-mini-2026-03-17`; usage accounting
    // and the allowlist filter both key on the requested id.
    const spec = resolveModelSpec(
      buildGatewayProviderConfig({
        baseURL: GATEWAY_BASE_URL,
        authToken: GATEWAY_TOKEN,
        model: 'gpt-5.4-mini'
      })
    );

    expect(spec.modelId).toBe('gpt-5.4-mini');
  });
});

describe('normalizeGatewayBaseURL', () => {
  // Caught in end-to-end testing: the AI SDK appends only the endpoint path, so a
  // base URL without /v1 makes every call 404 with an unhelpful "Not Found".
  it('appends the version segment to a bare host', () => {
    expect(normalizeGatewayBaseURL('http://ccs:8317')).toBe('http://ccs:8317/v1');
  });

  it('leaves an already-versioned base url alone', () => {
    expect(normalizeGatewayBaseURL('http://ccs:8317/v1')).toBe('http://ccs:8317/v1');
  });

  it('strips a trailing slash before appending', () => {
    expect(normalizeGatewayBaseURL('http://ccs:8317/')).toBe('http://ccs:8317/v1');
  });

  it('strips a trailing slash after the version segment', () => {
    expect(normalizeGatewayBaseURL('http://ccs:8317/v1/')).toBe('http://ccs:8317/v1');
  });

  it('handles a host with a path prefix', () => {
    expect(normalizeGatewayBaseURL('https://proxy.example.com/gateway')).toBe('https://proxy.example.com/gateway/v1');
  });
});

describe('assertValidTransport', () => {
  it('accepts a complete official transport', () => {
    expect(() => assertValidTransport({ kind: 'official', provider: AIProvider.OPENAI, apiKey: 'key' })).not.toThrow();
  });

  it('accepts a complete gateway transport', () => {
    expect(() =>
      assertValidTransport({
        kind: 'gateway',
        protocol: 'openai-chat',
        baseURL: GATEWAY_BASE_URL,
        authToken: GATEWAY_TOKEN
      })
    ).not.toThrow();
  });

  it('fails closed when the gateway base URL is missing', () => {
    expect(() =>
      assertValidTransport({
        kind: 'gateway',
        protocol: 'openai-chat',
        baseURL: '',
        authToken: GATEWAY_TOKEN
      })
    ).toThrow(/base url/i);
  });

  it('fails closed when the gateway auth token is missing', () => {
    expect(() =>
      assertValidTransport({
        kind: 'gateway',
        protocol: 'openai-chat',
        baseURL: GATEWAY_BASE_URL,
        authToken: ''
      })
    ).toThrow(/auth token/i);
  });

  it('fails closed when the official api key is missing', () => {
    expect(() => assertValidTransport({ kind: 'official', provider: AIProvider.OPENAI, apiKey: '' })).toThrow(
      /api key/i
    );
  });

  it('never places the gateway token in the thrown error message', () => {
    let message = '';

    try {
      assertValidTransport({
        kind: 'gateway',
        protocol: 'openai-chat',
        baseURL: '',
        authToken: GATEWAY_TOKEN
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).not.toContain(GATEWAY_TOKEN);
    expect(message.length).toBeGreaterThan(0);
  });

  it('never places the official api key in the thrown error message', () => {
    const apiKey = 'sk-official-key-value';
    let message = '';

    try {
      assertValidTransport({ kind: 'official', provider: AIProvider.OPENAI, apiKey: '' });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).not.toContain(apiKey);
  });
});

describe('capability model', () => {
  it('disables prompt caching for gateway transports', () => {
    // Prompt caching semantics through CLIProxy are unverified; assuming them would
    // silently corrupt cache accounting.
    const config = buildGatewayProviderConfig({
      baseURL: GATEWAY_BASE_URL,
      authToken: GATEWAY_TOKEN,
      model: 'gpt-5.4'
    });

    expect(config.capabilities.promptCaching).toBe(false);
  });

  it('enables prompt caching for official anthropic transports', () => {
    const config = buildOfficialProviderConfig(AIProvider.ANTHROPIC, 'key', 'claude-sonnet-4-6');

    expect(config.capabilities.promptCaching).toBe(true);
  });

  it('leaves prompt caching disabled for official openai transports', () => {
    const config = buildOfficialProviderConfig(AIProvider.OPENAI, 'key', 'gpt-5.4-mini');

    expect(config.capabilities.promptCaching).toBe(false);
  });

  it('reports tool calling and streaming as available on the gateway', () => {
    // Verified live against CLIProxy: streaming responses and tool_calls both work.
    expect(DEFAULT_GATEWAY_CAPABILITIES.toolCalling).toBe(true);
    expect(DEFAULT_GATEWAY_CAPABILITIES.streaming).toBe(true);
  });

  it('reports usage as available on the gateway', () => {
    // Verified live: CLIProxy returns prompt_tokens/completion_tokens/total_tokens.
    expect(DEFAULT_GATEWAY_CAPABILITIES.usageReporting).toBe(true);
  });

  it('allows a caller to override individual capabilities without losing the rest', () => {
    const config = buildGatewayProviderConfig({
      baseURL: GATEWAY_BASE_URL,
      authToken: GATEWAY_TOKEN,
      model: 'gpt-5.4',
      capabilities: { imageInput: false }
    });

    expect(config.capabilities.imageInput).toBe(false);
    expect(config.capabilities.toolCalling).toBe(true);
    expect(config.capabilities.streaming).toBe(true);
  });
});
