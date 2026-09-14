<script lang="ts">
  import { page } from '$app/state';

  import { PageRestricted } from '$features/ui';
  import LanguagePicker from '$features/ui/language-picker.svelte';
  import { currentOrg } from '$lib/utils/store/org';
  import { onMount } from 'svelte';
  import { afterNavigate } from '$app/navigation';
  import { getRequestBaseUrl } from '$lib/utils/services/api';
  import type { Snippet } from 'svelte';
  import type { PublicOrg } from '$features/app/types';

  interface Props {
    children?: Snippet;
    data: {
      isOrgSite: boolean;
      org: PublicOrg | null;
    };
  }

  let { children, data }: Props = $props();
  let trackPageView: ((fields: { kind: 'landing' | 'course'; path?: string }) => void) | null = null;

  onMount(() => {
    const apiBaseUrl = getRequestBaseUrl();
    if (!apiBaseUrl) return;

    void import('@cio/analytics/client')
      .then(({ analytics }) => {
        analytics.init({
          endpoint: `${apiBaseUrl.replace(/\/$/, '')}/dash/track`,
          orgId: data.org?.id ?? undefined
        });
        trackPageView = analytics.pageView;
        analytics.pageView({ kind: 'landing' });
      })
      .catch((error: unknown) => {
        console.warn('Client analytics unavailable:', error);
      });
  });

  afterNavigate(({ to }) => {
    if (!to) return;

    const isCoursePage = /\/course\//.test(to.url.pathname);
    trackPageView?.({
      kind: isCoursePage ? 'course' : 'landing',
      path: to.url.pathname
    });
  });
</script>

<!--
  The public pages carry no header of their own to hang this on — a course, a lesson, the
  course list — so the layout floats it in the corner they all leave empty.

  The exam route is the one exception and draws its own inside its header: it is the only
  page here with chrome, and its top-right corner already holds a running clock.
-->
{#if !page.url.pathname.startsWith('/exam/')}
  <div class="fixed top-3 right-3 z-30">
    <LanguagePicker variant="outline" />
  </div>
{/if}

{#if data.org?.isRestricted || $currentOrg.isRestricted}
  <PageRestricted />
{:else}
  {@render children?.()}
{/if}
