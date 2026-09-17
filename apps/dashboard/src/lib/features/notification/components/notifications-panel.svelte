<script lang="ts">
  import * as Empty from '@cio/ui/base/empty';
  import { Button } from '@cio/ui/base/button';
  import * as DropdownMenu from '@cio/ui/base/dropdown-menu';
  import * as UnderlineTabs from '@cio/ui/custom/underline-tabs';
  import CheckCheckIcon from '@lucide/svelte/icons/check-check';
  import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
  import EyeIcon from '@lucide/svelte/icons/eye';
  import MessageSquarePlusIcon from '@lucide/svelte/icons/message-square-plus';
  import { globalStore } from '$lib/utils/store/app';
  import { showUserJotWidget } from '$lib/utils/services/userjot';
  import { t } from '$lib/utils/functions/translations';
  import { notificationApi } from '../api/notification.svelte';
  import NotificationList from './notification-list.svelte';

  /**
   * Upstream's panel layout — title, overflow menu, Direct and Watching tabs — over this fork's
   * notification service. Upstream's own panel listed pending invites only; this service has
   * real read state, which is why "Mark all as read" can live in the menu upstream left empty.
   */
  const DIRECT_TAB = 'direct';
  const WATCHING_TAB = 'watching';

  // Kept as a plain string: UnderlineTabs.Root types `value` as string, so a union breaks bind:.
  let activeTab = $state(DIRECT_TAB);
</script>

<div class="flex items-center justify-between gap-2 px-4 py-3">
  <p class="text-lg font-normal tracking-tight">{$t('notifications.title')}</p>

  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <Button {...props} variant="secondary" size="icon" class="size-7">
          <EllipsisIcon class="size-4" />
          <span class="sr-only">{$t('notifications.more_options')}</span>
        </Button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end">
      <DropdownMenu.Item disabled={notificationApi.unread === 0} onclick={() => notificationApi.markAllRead()}>
        <span class="flex w-full items-center gap-2">
          <CheckCheckIcon size={16} />
          <p class="text-sm">{$t('notifications.mark_all_read')}</p>
        </span>
      </DropdownMenu.Item>
      {#if !$globalStore.isOrgSite}
        <DropdownMenu.Item onclick={() => showUserJotWidget('feedback')}>
          <span class="flex w-full items-center gap-2">
            <MessageSquarePlusIcon size={16} />
            <p class="text-sm">{$t('notifications.give_feedback')}</p>
          </span>
        </DropdownMenu.Item>
      {/if}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
</div>

<UnderlineTabs.Root bind:value={activeTab} class="gap-0">
  <UnderlineTabs.List class="px-2">
    <UnderlineTabs.Trigger value={DIRECT_TAB}>{$t('notifications.tabs.direct')}</UnderlineTabs.Trigger>
    <UnderlineTabs.Trigger value={WATCHING_TAB}>{$t('notifications.tabs.watching')}</UnderlineTabs.Trigger>
  </UnderlineTabs.List>

  <UnderlineTabs.Content value={DIRECT_TAB}>
    <NotificationList />
  </UnderlineTabs.Content>

  <UnderlineTabs.Content value={WATCHING_TAB}>
    <Empty.Root>
      <Empty.Header>
        <Empty.Media variant="icon">
          <EyeIcon />
        </Empty.Media>
        <Empty.Title>{$t('notifications.watching_empty_title')}</Empty.Title>
        <Empty.Description>{$t('notifications.watching_empty_description')}</Empty.Description>
      </Empty.Header>
    </Empty.Root>
  </UnderlineTabs.Content>
</UnderlineTabs.Root>
