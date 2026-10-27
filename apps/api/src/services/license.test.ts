import { describe, expect, it } from 'vitest';
import { LICENSE_FEATURE } from '@cio/utils/license';
import { getLicenseStatus, isFeatureLicensed, isFeatureLicensedSync } from '@cio/core/services/license';

describe('deployment capabilities', () => {
  it('enables every known ClassroomHub capability', async () => {
    const status = await getLicenseStatus();

    expect(status).toEqual({
      valid: true,
      features: Object.values(LICENSE_FEATURE)
    });
  });

  it('denies unknown capabilities', async () => {
    expect(await isFeatureLicensed('upstream-only-feature')).toBe(false);
    expect(isFeatureLicensedSync('upstream-only-feature')).toBe(false);
  });
});
