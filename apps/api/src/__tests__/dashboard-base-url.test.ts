import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Locks the host every org email link resolves to. The bug this guards against:
 * a person invited into tenant `msna` received a link to the platform host
 * (`hub.classroom.io.vn`) instead of `msna.classroom.io.vn`, because
 * `DASHBOARD_ORIGIN` was consulted before the org's own subdomain. On this
 * platform the host a link opens on is where the recipient's session forms, so
 * the wrong host is a security problem, not a cosmetic one.
 *
 * What decides the tenant-subdomain branch is whether `DASHBOARD_ORIGIN` is
 * itself on the tenant root domain — not a deployment flag. These pin that.
 *
 * `getDashboardBaseUrl` resolves env at module load, so each case re-imports.
 */

async function loadResolver(env: Record<string, string>) {
  vi.resetModules();

  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }

  const module = await import('@cio/core/config/dashboard-url');

  return module;
}

const MSNA = { siteName: 'msna', customDomain: null, isCustomDomainVerified: false };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('getDashboardBaseUrl', () => {
  it('sends an org to its own subdomain when the platform origin is on the tenant root', async () => {
    // The reported production configuration: DASHBOARD_ORIGIN=hub.<root>.
    const { getDashboardBaseUrl } = await loadResolver({
      NODE_ENV: 'production',
      DASHBOARD_ORIGIN: 'https://hub.classroom.io.vn'
    });

    expect(getDashboardBaseUrl(MSNA)).toBe('https://msna.classroom.io.vn');
  });

  it('routes org staff links to the org site too — getAppBaseUrl stays on the platform host', async () => {
    // Under the one-host-per-org model both learners and staff work on the org
    // site; only platform/super-admin links (no org) stay on hub.
    const { getDashboardBaseUrl, getAppBaseUrl } = await loadResolver({
      NODE_ENV: 'production',
      DASHBOARD_ORIGIN: 'https://hub.classroom.io.vn'
    });

    expect(getDashboardBaseUrl(MSNA)).toBe('https://msna.classroom.io.vn');
    expect(getAppBaseUrl()).toBe('https://hub.classroom.io.vn');
  });

  it('does not depend on PUBLIC_IS_SELF_OWNED — the origin host decides', async () => {
    // Even with the self-hosted flag set, an origin on the tenant root means the
    // subdomain is a real sibling host and wins.
    const { getDashboardBaseUrl } = await loadResolver({
      NODE_ENV: 'production',
      PUBLIC_IS_SELF_OWNED: 'false',
      PUBLIC_IS_SELFHOSTED: 'true',
      DASHBOARD_ORIGIN: 'https://hub.classroom.io.vn'
    });

    expect(getDashboardBaseUrl(MSNA)).toBe('https://msna.classroom.io.vn');
  });

  it('lets a verified custom domain win over the tenant subdomain', async () => {
    const { getDashboardBaseUrl } = await loadResolver({
      NODE_ENV: 'production',
      DASHBOARD_ORIGIN: 'https://hub.classroom.io.vn'
    });

    expect(
      getDashboardBaseUrl({ siteName: 'msna', customDomain: 'learn.msna.com', isCustomDomainVerified: true })
    ).toBe('https://learn.msna.com');
  });

  it('does not route to a tenant subdomain in local development', async () => {
    const { getDashboardBaseUrl } = await loadResolver({
      NODE_ENV: 'development',
      DASHBOARD_ORIGIN: ''
    });

    expect(getDashboardBaseUrl(MSNA)).toBe('http://localhost:8000');
  });

  it('keeps DASHBOARD_ORIGIN authoritative for a self-hosted install on its own domain', async () => {
    // learn.acme.com is not under the tenant root, so there are no routable
    // <siteName>.<product root> subdomains and the configured origin stays the
    // host even when the org has a siteName.
    const { getDashboardBaseUrl } = await loadResolver({
      NODE_ENV: 'production',
      DASHBOARD_ORIGIN: 'https://learn.acme.com'
    });

    expect(getDashboardBaseUrl(MSNA)).toBe('https://learn.acme.com');
  });
});
