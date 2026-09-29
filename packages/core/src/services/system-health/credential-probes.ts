import type { HealthProbe, ProbeOutcome } from './types';

/**
 * Probes that prove a third-party credential still works, each with the cheapest
 * authenticated read the provider offers (a model or token listing — no generation, no
 * quota spend).
 *
 * Reads `process.env` directly: several of these keys sit outside the validated env
 * schema, and a health check must see exactly what the running process sees.
 */

function readEnv(name: string): string {
  return (process.env[name] ?? '').trim();
}

/** Maps an HTTP answer onto a check outcome without ever echoing the credential. */
export function outcomeFromHttpStatus(status: number, okDetail: string): ProbeOutcome {
  if (status >= 200 && status < 300) return { status: 'ok', detail: okDetail };
  if (status === 401 || status === 403) return { status: 'fail', detail: `Credential rejected (HTTP ${status})` };
  // Throttled means the key was accepted; the provider is only asking us to slow down.
  if (status === 429) return { status: 'warn', detail: 'Credential accepted but rate limited (HTTP 429)' };

  return { status: 'fail', detail: `Unexpected response (HTTP ${status})` };
}

async function probeHttp(url: string, headers: Record<string, string>, okDetail: string): Promise<ProbeOutcome> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(8_000) });
  // Drain the body so the connection is released; its content is never reported.
  await response.arrayBuffer().catch(() => undefined);

  return outcomeFromHttpStatus(response.status, okDetail);
}

const unconfigured = (what: string): ProbeOutcome => ({ status: 'unconfigured', detail: `${what} is not set` });

function bearerModelsProbe(id: string, label: string, envName: string, url: string): HealthProbe {
  return {
    id,
    group: 'ai',
    label,
    run: async () => {
      const key = readEnv(envName);
      if (!key) return unconfigured(envName);

      return probeHttp(url, { Authorization: `Bearer ${key}` }, 'Key accepted');
    }
  };
}

export function getCredentialProbes(): HealthProbe[] {
  return [
    {
      id: 'ai-gateway',
      group: 'ai',
      label: 'AI gateway (CLIProxyAPI)',
      run: async () => {
        const baseURL = readEnv('AI_GATEWAY_BASE_URL').replace(/\/+$/, '');
        const token = readEnv('AI_GATEWAY_AUTH_TOKEN');
        if (!baseURL && !token) return unconfigured('AI_GATEWAY_BASE_URL and AI_GATEWAY_AUTH_TOKEN');
        if (!baseURL || !token) {
          return { status: 'fail', detail: 'Only one of AI_GATEWAY_BASE_URL / AI_GATEWAY_AUTH_TOKEN is set' };
        }

        const modelsUrl = `${baseURL.endsWith('/v1') ? baseURL : `${baseURL}/v1`}/models`;
        const response = await fetch(modelsUrl, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(8_000)
        });
        if (!response.ok) return outcomeFromHttpStatus(response.status, '');

        const body = (await response.json().catch(() => null)) as { data?: unknown[] } | null;
        const count = Array.isArray(body?.data) ? body.data.length : 0;

        return count > 0
          ? { status: 'ok', detail: `Reachable, token accepted, ${count} models advertised` }
          : { status: 'warn', detail: 'Reachable and token accepted, but no models advertised' };
      }
    },
    bearerModelsProbe('ai-openai', 'OpenAI API key', 'OPENAI_API_KEY', 'https://api.openai.com/v1/models'),
    bearerModelsProbe('ai-moonshot', 'Moonshot API key', 'MOONSHOT_API_KEY', 'https://api.moonshot.ai/v1/models'),
    {
      id: 'ai-anthropic',
      group: 'ai',
      label: 'Anthropic API key',
      run: async () => {
        const key = readEnv('ANTHROPIC_API_KEY');
        if (!key) return unconfigured('ANTHROPIC_API_KEY');

        return probeHttp(
          'https://api.anthropic.com/v1/models?limit=1',
          { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          'Key accepted'
        );
      }
    },
    {
      id: 'ai-google',
      group: 'ai',
      label: 'Google AI API key',
      run: async () => {
        const key = readEnv('GOOGLE_API_KEY');
        if (!key) return unconfigured('GOOGLE_API_KEY');

        return probeHttp(
          'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
          { 'x-goog-api-key': key },
          'Key accepted'
        );
      }
    },
    {
      id: 'unsplash',
      group: 'integrations',
      label: 'Unsplash API key',
      run: async () => {
        const key = readEnv('UNSPLASH_API_KEY');
        if (!key) return unconfigured('UNSPLASH_API_KEY');

        return probeHttp(
          'https://api.unsplash.com/photos?per_page=1',
          { Authorization: `Client-ID ${key}` },
          'Key accepted'
        );
      }
    },
    {
      id: 'cloudflare-rendering',
      group: 'integrations',
      label: 'Cloudflare Browser Rendering (certificates, PDFs, OG images)',
      run: async () => {
        const token = readEnv('CLOUDFLARE_RENDERING_API_KEY');
        const accountId = readEnv('CLOUDFLARE_ACCOUNT_ID');
        if (!token && !accountId) return unconfigured('CLOUDFLARE_RENDERING_API_KEY');
        // Rendering calls go to accounts/<id>/..., so a token without the account id breaks
        // every certificate and PDF download just as surely as a revoked token.
        if (!accountId) return { status: 'fail', detail: 'CLOUDFLARE_ACCOUNT_ID is missing; rendering cannot run' };
        if (!token) return { status: 'fail', detail: 'CLOUDFLARE_RENDERING_API_KEY is missing' };

        const headers = { Authorization: `Bearer ${token}` };
        const accountCheck = await probeHttp(
          `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/tokens/verify`,
          headers,
          'Account token active'
        );
        if (accountCheck.status === 'ok') return accountCheck;

        // User-owned tokens only verify on the user endpoint.
        return probeHttp('https://api.cloudflare.com/client/v4/user/tokens/verify', headers, 'User token active');
      }
    },
    {
      id: 'sentry',
      group: 'integrations',
      label: 'Sentry DSN',
      run: async () => {
        const dsn = readEnv('SENTRY_DSN');
        if (!dsn) return unconfigured('SENTRY_DSN');

        try {
          const parsed = new URL(dsn);
          const valid = parsed.protocol === 'https:' && parsed.username && parsed.pathname.length > 1;

          return valid
            ? { status: 'ok', detail: `Well-formed DSN for ${parsed.hostname}` }
            : { status: 'fail', detail: 'SENTRY_DSN is not a valid DSN' };
        } catch {
          return { status: 'fail', detail: 'SENTRY_DSN is not a valid URL' };
        }
      }
    },
    presenceProbe('supadata', 'Supadata (YouTube captions)', ['SUPADATA_API_KEY']),
    presenceProbe('jina', 'Jina reader', ['JINA_API_KEY']),
    presenceProbe('google-oauth', 'Google sign-in (OAuth)', ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'])
  ];
}

/**
 * For credentials that cannot be verified without side effects (an OAuth secret only
 * proves itself inside a real sign-in). Reports configuration, and flags half-set pairs,
 * which fail at runtime in a way that looks like a user error.
 */
function presenceProbe(id: string, label: string, names: string[]): HealthProbe {
  return {
    id,
    group: 'integrations',
    label,
    run: async () => {
      const missing = names.filter((name) => !readEnv(name));
      if (missing.length === names.length) return unconfigured(names.join(' / '));
      if (missing.length > 0) return { status: 'fail', detail: `Partially configured; missing ${missing.join(', ')}` };

      return { status: 'ok', detail: 'Configured (no side-effect-free verification available)' };
    }
  };
}
