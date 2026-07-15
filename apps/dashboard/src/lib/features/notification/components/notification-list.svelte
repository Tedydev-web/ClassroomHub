<script lang="ts">
  import CheckCheckIcon from '@lucide/svelte/icons/check-check';
  import { Button } from '@cio/ui/base/button';
  import { notificationApi } from '../api/notification.svelte';
  import { t } from '$lib/utils/functions/translations';

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

<div class="w-80">
  <div class="flex items-center justify-between border-b px-3 py-2">
    <strong class="text-sm">{$t('settings.notifications.heading')}</strong>
    {#if notificationApi.unread > 0}
      <Button
        variant="secondary"
        size="icon-xs"
        title={$t('settings.notifications.heading')}
        onclick={() => notificationApi.markAllRead()}
      >
        <CheckCheckIcon />
      </Button>
    {/if}
  </div>
  <div class="max-h-96 overflow-y-auto">
    {#each notificationApi.items as notification (notification.id)}
      <button
        type="button"
        class="ui:hover:bg-muted flex w-full gap-3 border-b px-3 py-3 text-left last:border-b-0"
        class:font-medium={!notification.isRead}
        onclick={() => openNotification(notification.id, notification.isRead, notification.metadata)}
      >
        <span class={`mt-1.5 size-2 shrink-0 rounded-full ${notification.isRead ? 'bg-transparent' : 'ui:bg-primary'}`}
        ></span>
        <span class="min-w-0">
          <span class="block text-sm">{notification.title}</span>
          {#if notification.body}
            <span class="ui:text-muted-foreground mt-1 block text-xs">{notification.body}</span>
          {/if}
        </span>
      </button>
    {/each}
  </div>
</div>
