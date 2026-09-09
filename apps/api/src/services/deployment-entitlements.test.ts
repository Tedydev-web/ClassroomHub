import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, test, vi } from 'vitest';

import { isEnabledDeploymentFlag } from '@cio/core/config/deployment';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

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

  /**
   * Regression: a plan gate must read the deployment's entitlements, not the
   * self-hosting flag on its own.
   *
   * `hasFullProductEntitlements` is `isSelfHostedDeployment || isSelfOwnedDeployment`,
   * and three gates read `env.PUBLIC_IS_SELFHOSTED` directly instead. On this
   * deployment — self-owned, self-hosting off, and with no plan row at all — that
   * left "Allow public signups" and "Internal enrollment only" permanently locked
   * behind an upgrade badge, and public API keys refused, while every gate that did
   * use the wider flag treated the same org as Enterprise. The two halves of the
   * dashboard disagreed about what the org had paid for.
   *
   * The check is on the source because the values were never wrong — they were
   * bypassed. A unit test on `canUseBasicAuthSettings` passed throughout.
   */
  test('plan gates read deployment entitlements, not the self-hosting flag alone', () => {
    const sources = [
      'apps/api/src/services/organization.ts',
      'apps/api/src/services/organization/automation-usage.ts',
      'apps/dashboard/src/lib/utils/store/org.ts'
    ];

    for (const relative of sources) {
      const source = readFileSync(join(repoRoot, relative), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

      for (const [, call] of source.matchAll(/can(?:UseBasicAuthSettings|UsePublicApi)\(([^)]*)\)/g)) {
        expect(
          /hasFullProductEntitlements|isSelfOwnedDeployment/.test(call),
          `${relative} gates on \`${call.trim()}\`, which ignores a self-owned deployment`
        ).toBe(true);
      }
    }
  });
});
