<script lang="ts">
  import { onMount } from 'svelte';
  import { Separator } from '@cio/ui/base/separator';
  import * as Sidebar from '@cio/ui/base/sidebar';
  import BellIcon from '@lucide/svelte/icons/bell';
  import { Button } from '@cio/ui/base/button';
  import * as Popover from '@cio/ui/base/popover';
  import Search from '$features/ui/search.svelte';
  import AppBreadcrumbs from './app-breadcrumbs.svelte';
  import { currentOrg } from '$lib/utils/store/org';
  import { setupProgressApi } from '$features/setup/api/setup-progress.svelte';
  import AppSetup from './app-setup.svelte';
  import VisitOrgSiteBtn from '$features/ui/visit-org-site-btn.svelte';
  import NotificationsPanel from '$features/notification/components/notifications-panel.svelte';
  import { notificationApi } from '$features/notification/api/notification.svelte';

  const siteName = $derived($currentOrg.siteName);

  onMount(() => {
    notificationApi.getNotifications();
  });

  $effect(() => {
    if (!siteName) return;

    setupProgressApi.fetchSetupProgress(siteName);
  });
</script>

<header
  class="ui:border-border ui:bg-background sticky top-0 z-50 flex h-12 w-full shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-8"
>
  <div class="flex w-full items-center gap-2 px-4">
    <Sidebar.Trigger testId="app-sidebar-trigger" />

    <div class="h-4 w-2">
      <Separator orientation="vertical" />
    </div>

    <AppBreadcrumbs />

    <span class="grow"></span>

    <AppSetup />
    <VisitOrgSiteBtn variant="outline" labelKey="dashboard.open_academy" />

    <Search />

    <div class="relative">
      <Popover.Root>
        <Popover.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="secondary" size="icon" testId="app-notifications-trigger">
              <BellIcon class="custom rounded-full" />
            </Button>
          {/snippet}
        </Popover.Trigger>
        <Popover.Content align="end" sideOffset={8} class="ui:p-0! w-[460px]">
          <NotificationsPanel />
        </Popover.Content>
      </Popover.Root>

      {#if notificationApi.unread > 0}
        <span
          class="ui:bg-primary ui:text-primary-foreground pointer-events-none absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium"
        >
          {notificationApi.unread}
        </span>
      {/if}
    </div>
  </div>
</header>
