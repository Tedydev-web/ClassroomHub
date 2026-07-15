import { env } from './env';

export function isEnabledDeploymentFlag(value: string | undefined): boolean {
  return value === 'true';
}

export const isSelfHostedDeployment = isEnabledDeploymentFlag(env.PUBLIC_IS_SELFHOSTED);
export const isSelfOwnedDeployment = isEnabledDeploymentFlag(env.PUBLIC_IS_SELF_OWNED);
export const hasFullProductEntitlements = isSelfHostedDeployment || isSelfOwnedDeployment;
