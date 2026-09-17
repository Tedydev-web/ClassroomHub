<script lang="ts">
  import BellIcon from '@lucide/svelte/icons/bell';
  import RefreshCcwIcon from '@lucide/svelte/icons/refresh-ccw';
  import { Button } from '@cio/ui/base/button';
  import * as Empty from '@cio/ui/base/empty';
  import { calDateDiff } from '$lib/utils/functions/date';
  import { t } from '$lib/utils/functions/translations';
  import { notificationApi } from '../api/notification.svelte';

  function getLink(metadata: Record<string, unknown>): string | null {
    const link = metadata.link;

    return typeof link === 'string' && link.startsWith('/') ? link : null;
  }

  async function openNotification(notificationId: string, isRead: boolean, metadata: Record<string, unknown>) {
    if (!isRead) {
      await notificationApi.markRead(notificationId);
    }

    const link = getLink(metadata);
    if (link) {
      window.location.assign(link);
    }
  }
</script>

{#if !notificationApi.hasLoaded}
  <!-- Nothing until the first fetch settles, so the empty state cannot flash. -->
  <div class="space-y-3 px-4 py-4">
    {#each [0, 1, 2] as row (row)}
      <div class="flex items-start gap-3">
        <div class="ui:bg-muted mt-1.5 size-2 shrink-0 animate-pulse rounded-full"></div>
        <div class="flex-1 space-y-1.5">
          <div class="ui:bg-muted h-3 w-1/3 animate-pulse rounded"></div>
          <div class="ui:bg-muted h-3 w-2/3 animate-pulse rounded"></div>
        </div>
      </div>
    {/each}
  </div>
{:else if notificationApi.items.length === 0}
  <Empty.Root>
    <Empty.Header>
      <Empty.Media variant="icon">
        <BellIcon />
      </Empty.Media>
      <Empty.Title>{$t('notifications.empty_title')}</Empty.Title>
      <Empty.Description>{$t('notifications.empty_description')}</Empty.Description>
    </Empty.Header>
    <Empty.Content>
      <Button
        variant="outline"
        size="sm"
        loading={notificationApi.isLoading}
        onclick={() => notificationApi.getNotifications()}
      >
        <RefreshCcwIcon />
        {$t('notifications.refresh')}
      </Button>
    </Empty.Content>
  </Empty.Root>
{:else}
  <p class="ui:text-muted-foreground px-4 pt-2 pb-1 text-xs font-medium">{$t('notifications.latest')}</p>

  <div class="max-h-80 overflow-y-auto">
    {#each notificationApi.items as notification (notification.id)}
      <button
        type="button"
        class="ui:hover:bg-muted grid w-full cursor-pointer grid-cols-[1fr_auto] items-start gap-3 px-4 py-3 text-left transition-colors"
        onclick={() => openNotification(notification.id, notification.isRead, notification.metadata)}
      >
        <div class="min-w-0 space-y-0.5">
          <p class="text-sm" class:font-medium={!notification.isRead}>{notification.title}</p>
          {#if notification.body}
            <p class="ui:text-muted-foreground text-xs">{notification.body}</p>
          {/if}
          <p class="ui:text-muted-foreground text-xs">{calDateDiff(notification.createdAt)}</p>
        </div>

        {#if !notification.isRead}
          <span class="ui:bg-primary mt-1.5 size-2 shrink-0 rounded-full">
            <span class="sr-only">{$t('notifications.unread')}</span>
          </span>
        {/if}
      </button>
    {/each}
  </div>
{/if}
