import { LICENSE_FEATURE, type LicenseFeatureId } from '@cio/utils/license';

export type LicenseStatus = {
  valid: boolean;
  features: string[];
  expiresAt?: string;
};

const ENABLED_FEATURES: readonly LicenseFeatureId[] = Object.values(LICENSE_FEATURE);

/**
 * Returns the capabilities owned by this ClassroomHub deployment.
 */
export async function getLicenseStatus(): Promise<LicenseStatus> {
  return { valid: true, features: [...ENABLED_FEATURES] };
}

/**
 * Checks whether this deployment owns a known feature capability.
 */
export async function isFeatureLicensed(feature: LicenseFeatureId | string): Promise<boolean> {
  return ENABLED_FEATURES.some((enabledFeature) => enabledFeature === feature);
}

/**
 * Synchronous capability check for call sites that cannot await.
 */
export function isFeatureLicensedSync(feature: LicenseFeatureId | string): boolean {
  return ENABLED_FEATURES.some((enabledFeature) => enabledFeature === feature);
}
