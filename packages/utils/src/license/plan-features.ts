import { PLAN } from '../plans/constants';
import { LICENSE_FEATURE, type LicenseFeatureId } from './constants';

type OrgPlan = {
  planName: string | null;
  isActive: boolean | null;
};

export function getActivePlanName(plans: OrgPlan[] | undefined | null): string | null {
  const activePlan = plans?.find((plan) => plan.isActive);

  return activePlan?.planName ?? null;
}

/**
 * Maps an organization plan to dashboard capability IDs.
 */
export function getLicenseFeaturesForPlan(planName: string | null | undefined): LicenseFeatureId[] {
  if (!planName || planName === PLAN.BASIC) {
    return [];
  }

  if (planName === PLAN.EARLY_ADOPTER) {
    return [LICENSE_FEATURE.CUSTOM_DOMAIN, LICENSE_FEATURE.CUSTOM_BRANDING];
  }

  if (planName === PLAN.ENTERPRISE) {
    return Object.values(LICENSE_FEATURE);
  }

  return [];
}
