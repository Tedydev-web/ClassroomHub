<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import * as Sidebar from '@cio/ui/base/sidebar';
  import { Skeleton } from '@cio/ui/base/skeleton';
  import { currentOrg } from '$lib/utils/store/org';
  import { isOrgStudent } from '$lib/utils/store/app';
  import { appInitApi } from '$features/app/init.svelte';
  import { AppHeader } from '$features/ui';
  import { PUBLIC_IS_SELFHOSTED } from '$env/static/public';

  import { OrgSidebar } from '$features/ui/sidebar/org-sidebar';
  import { AddOrgModal } from '$features/org';
  import { findDisabledOrgFeature } from '$features/ui/navigation/org-navigation';

  let { data, children } = $props();

  function redirect(siteName: string | null) {
    if (!siteName) return;

    const newUrl = page.url.pathname.replace('*', siteName);
    goto(newUrl + page.url.search);
  }

  $effect(() => {
    if (data.orgName === '*') {
      void redirect($currentOrg.siteName);
    }
  });

  /**
   * A feature the operator switched off has no sidebar entry, but its route is
   * still typed into the address bar or reached from a stale link. Send those
   * back to the org home rather than rendering a page the org is not meant to
   * see. Waits for init so the redirect is decided against loaded settings and
   * not against the store's empty initial value.
   */
  const disabledFeature = $derived(
    appInitApi.isInitializedAndReady && $currentOrg.siteName
      ? findDisabledOrgFeature($currentOrg, page.url.pathname)
      : null
  );

  $effect(() => {
    if (!disabledFeature) return;
    goto(`/org/${$currentOrg.siteName}`, { replaceState: true });
  });

  $effect(() => {
    // Students must not use the admin org dashboard on app.* — send them to LMS.
    // isStudentExperience is false on the app host in cloud mode even for students.
    if (appInitApi.isInitializedAndReady && $isOrgStudent) {
      goto(resolve('/lms', {}));
    }
  });
</script>

{#if PUBLIC_IS_SELFHOSTED !== 'true'}
  <AddOrgModal />
{/if}

<Sidebar.Provider>
  <OrgSidebar />

  <Sidebar.Inset>
    <AppHeader />

    <div class="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4">
      {#if data.orgName === '*' || disabledFeature}
        <!-- Also covers the switched-off case: the redirect above is in flight,
             and mounting the page would fire its data loads on the way out. -->
        <div class="grid auto-rows-min gap-4 md:grid-cols-3">
          <Skeleton class="aspect-video rounded-xl" />
          <Skeleton class="aspect-video rounded-xl" />
          <Skeleton class="aspect-video rounded-xl" />
        </div>
        <Skeleton class="h-[50vh] w-full rounded-xl" />
      {:else}
        {@render children?.()}
      {/if}
    </div>
  </Sidebar.Inset>
</Sidebar.Provider>
