import { PostHog } from 'posthog-node';
import { env } from '$env/dynamic/public';

const posthog =
  env.PUBLIC_IS_SELF_OWNED === 'true' || !env.PUBLIC_POSTHOG_KEY?.trim()
    ? null
    : new PostHog(env.PUBLIC_POSTHOG_KEY, {
        host: env.PUBLIC_POSTHOG_HOST?.trim() || 'https://app.posthog.com'
      });

export const client = {
  capture(properties: Parameters<PostHog['capture']>[0]): void {
    posthog?.capture(properties);
  }
};

await posthog?.shutdownAsync();
