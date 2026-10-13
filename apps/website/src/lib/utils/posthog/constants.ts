import { env } from '$env/dynamic/public';

export const POSTHOG_KEY = env.PUBLIC_POSTHOG_KEY?.trim() ?? '';
export const POSTHOG_HOST = env.PUBLIC_POSTHOG_HOST?.trim() || 'https://app.posthog.com';
export const POSTHOG_UI_HOST = env.PUBLIC_POSTHOG_UI_HOST?.trim() || undefined;
export const isPosthogEnabled = env.PUBLIC_IS_SELF_OWNED !== 'true' && POSTHOG_KEY !== '';
