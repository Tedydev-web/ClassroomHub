import { afterEach, describe, expect, it, vi } from 'vitest';

import { isEnabledDeploymentFlag } from '@cio/core/config/deployment';

describe('deployment entitlements', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('only enables an explicitly true deployment flag', () => {
    expect(isEnabledDeploymentFlag('true')).toBe(true);
    expect(isEnabledDeploymentFlag('false')).toBe(false);
    expect(isEnabledDeploymentFlag(undefined)).toBe(false);
  });

  it('grants full product entitlements without enabling single-org self-hosting', async () => {
    vi.stubEnv('PUBLIC_IS_SELFHOSTED', 'false');
    vi.stubEnv('PUBLIC_IS_SELF_OWNED', 'true');
    vi.resetModules();

    const deployment = await import('@cio/core/config/deployment');

    expect(deployment.isSelfHostedDeployment).toBe(false);
    expect(deployment.isSelfOwnedDeployment).toBe(true);
    expect(deployment.hasFullProductEntitlements).toBe(true);
  });
});
