import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Locks the host a learner-facing link resolves to. The bug this guards against:
 * a student invited into tenant `msna` received a link to the platform admin
 * host (`hub.classroom.io.vn`) instead of `msna.classroom.io.vn`, because
 * `DASHBOARD_ORIGIN` was consulted before the org's own subdomain.
 *
 * `getDashboardBaseUrl` resolves deployment flags and env at module load, so
 * each case re-imports the module with the env it needs.
 */

async function loadResolver(env: Record<string, string>) {
  vi.resetModules();

  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }

  const module = await import('@cio/core/config/dashboard-url');

  return module.getDashboardBaseUrl;
}

const MSNA = { siteName: 'msna', customDomain: null, isCustomDomainVerified: false };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('getDashboardBaseUrl', () => {
  it('sends a hosted tenant to its own subdomain, not the platform host', async () => {
    // The reported production configuration: self-owned, DASHBOARD_ORIGIN=hub.
    const getDashboardBaseUrl = await loadResolver({
      NODE_ENV: 'production',
      PUBLIC_IS_SELF_OWNED: 'true',
      PUBLIC_IS_SELFHOSTED: 'false',
      DASHBOARD_ORIGIN: 'https://hub.classroom.io.vn'
    });

    expect(getDashboardBaseUrl(MSNA)).toBe('https://msna.classroom.io.vn');
  });

  it('still uses the platform host when the org has no site of its own', async () => {
    const getDashboardBaseUrl = await loadResolver({
      NODE_ENV: 'production',
      PUBLIC_IS_SELF_OWNED: 'true',
      DASHBOARD_ORIGIN: 'https://hub.classroom.io.vn'
    });

    expect(getDashboardBaseUrl()).toBe('https://hub.classroom.io.vn');
    expect(getDashboardBaseUrl({ siteName: null, customDomain: null, isCustomDomainVerified: false })).toBe(
      'https://hub.classroom.io.vn'
    );
  });

  it('lets a verified custom domain win over the tenant subdomain', async () => {
    const getDashboardBaseUrl = await loadResolver({
      NODE_ENV: 'production',
      PUBLIC_IS_SELF_OWNED: 'true',
      DASHBOARD_ORIGIN: 'https://hub.classroom.io.vn'
    });

    expect(
      getDashboardBaseUrl({ siteName: 'msna', customDomain: 'learn.msna.com', isCustomDomainVerified: true })
    ).toBe('https://learn.msna.com');
  });

  it('does not route to a tenant subdomain in local development', async () => {
    const getDashboardBaseUrl = await loadResolver({
      NODE_ENV: 'development',
      PUBLIC_IS_SELF_OWNED: 'true',
      DASHBOARD_ORIGIN: ''
    });

    expect(getDashboardBaseUrl(MSNA)).toBe('http://localhost:8000');
  });

  it('keeps DASHBOARD_ORIGIN authoritative for a self-hosted single-host install', async () => {
    // Self-hosted has no routable <siteName>.<product root> subdomains, so the
    // configured origin must remain the host even when the org has a siteName.
    const getDashboardBaseUrl = await loadResolver({
      NODE_ENV: 'production',
      PUBLIC_IS_SELF_OWNED: 'false',
      PUBLIC_IS_SELFHOSTED: 'true',
      DASHBOARD_ORIGIN: 'https://learn.acme.com'
    });

    expect(getDashboardBaseUrl(MSNA)).toBe('https://learn.acme.com');
  });
});
