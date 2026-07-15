import { env } from '$env/dynamic/public';

export const isSelfOwnedDeployment = env.PUBLIC_IS_SELF_OWNED === 'true';
