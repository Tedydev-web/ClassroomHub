import { PostHog } from 'posthog-node';
import { isPosthogEnabled, POSTHOG_HOST, POSTHOG_KEY } from './constants';

const posthog = isPosthogEnabled
  ? new PostHog(POSTHOG_KEY, { host: POSTHOG_HOST, flushAt: 1, flushInterval: 0 })
  : null;

export const client = {
  capture(properties: Parameters<PostHog['capture']>[0]): void {
    posthog?.capture(properties);
  },
  async flushAsync(): Promise<void> {
    await posthog?.flushAsync();
  }
};
