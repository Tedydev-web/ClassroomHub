<script lang="ts">
  import { Toaster } from '$lib/components/ui/sonner';
  import { Navigation } from '$lib/components/navigation';
  import posthog from 'posthog-js';
  import { dev } from '$app/environment';

  import '../app.css';
  import { onMount } from 'svelte';
  import { env } from '$env/dynamic/public';

  let { children } = $props();

  onMount(() => {
    if (dev) return;
    if (env.PUBLIC_IS_SELF_OWNED === 'true') return;

    const apiKey = env.PUBLIC_POSTHOG_KEY?.trim();
    if (!apiKey) return;

    posthog.init(apiKey, {
      api_host: env.PUBLIC_POSTHOG_API_HOST?.trim() || 'https://eu.i.posthog.com',
      person_profiles: 'identified_only' // or 'always' to create profiles for anonymous users as well
    });
  });
</script>

<Toaster />

<Navigation />

{@render children()}
