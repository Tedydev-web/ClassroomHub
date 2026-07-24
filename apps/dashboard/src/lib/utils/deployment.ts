import { env } from '$env/dynamic/public';

export const isSelfOwnedDeployment = env.PUBLIC_IS_SELF_OWNED === 'true';

// Show the Google social button only when the platform actually has Google
// OAuth configured. Without a client id, signIn.social({ provider: 'google' })
// hits the API's SOCIAL_AUTH_NOT_ENABLED guard, so an unconfigured deployment
// would otherwise render a button that dead-ends for every visitor. The public
// client id is not a secret (it travels in every OAuth URL), so reading it in
// the browser to gate the button is safe.
export const isGoogleAuthConfigured = !!env.PUBLIC_GOOGLE_CLIENT_ID?.trim();
