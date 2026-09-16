<script lang="ts">
  import { beforeNavigate, goto } from '$app/navigation';
  import * as Dialog from '@cio/ui/base/dialog';
  import { Button } from '@cio/ui/base/button';
  import { t } from '$lib/utils/functions/translations';

  interface Props {
    hasUnsavedChanges?: boolean;
    skipPrompt?: boolean;
    children?: import('svelte').Snippet;
  }

  let { hasUnsavedChanges = $bindable(false), skipPrompt = false, children }: Props = $props();

  let open = $state(false);
  let pendingUrl = $state<URL | null>(null);

  beforeNavigate((navigation) => {
    if (shouldAbandonChanges()) return;

    // Closing the tab is the browser's own prompt below. It cannot be replaced by an
    // in-page dialog, and showing both would make the user answer twice.
    if (navigation.type === 'leave') return;
    if (!navigation.to?.url) return;

    navigation.cancel();
    pendingUrl = navigation.to.url;
    open = true;
  });

  function shouldAbandonChanges() {
    if (!hasUnsavedChanges) return true;

    return skipPrompt;
  }

  function leave() {
    const url = pendingUrl;

    open = false;
    pendingUrl = null;
    // Cleared first, so the navigation this is about to start is not caught again by
    // the guard that produced the dialog.
    hasUnsavedChanges = false;

    if (url) void goto(url);
  }
</script>

<svelte:window
  onbeforeunload={(event) => {
    if (!shouldAbandonChanges()) event.preventDefault();
  }}
/>

<Dialog.Root
  bind:open
  onOpenChange={(isOpen) => {
    // Escape and the overlay both mean "stay". The safe answer is the one that keeps the
    // work, so dismissing the dialog must never be the destructive branch.
    if (!isOpen) pendingUrl = null;
  }}
>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>{$t('common.unsaved_changes.title')}</Dialog.Title>
      <Dialog.Description>{$t('common.unsaved_changes.message')}</Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => (open = false)}>
        {$t('common.unsaved_changes.stay')}
      </Button>
      <Button variant="destructive" onclick={leave}>
        {$t('common.unsaved_changes.leave')}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

{@render children?.()}
