<script lang="ts">
  import { t } from '$lib/utils/functions/translations';
  import { Button } from '@cio/ui/base/button';
  import * as Dialog from '@cio/ui/base/dialog';
  import { CopyInput } from '@cio/ui/custom/copy-input';

  interface Props {
    open: boolean;
    title: string;
    secret: string | null;
    description?: string;
    testId?: string;
  }

  let { open = $bindable(), title, secret, description, testId = 'automation-key-secret' }: Props = $props();

  let copyButton = $state<HTMLButtonElement | null>(null);

  function focusCopyButton(event: Event) {
    event.preventDefault();
    copyButton?.focus();
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="ui:sm:max-w-md" showCloseButton={false} onOpenAutoFocus={focusCopyButton}>
    <Dialog.Header>
      <Dialog.Title>{title}</Dialog.Title>
      <Dialog.Description>{description ?? $t('automation.keys.reveal.description')}</Dialog.Description>
    </Dialog.Header>

    <CopyInput
      value={secret ?? ''}
      bind:buttonRef={copyButton}
      copyLabel={$t('automation.keys.reveal.copy')}
      copiedLabel={$t('automation.keys.reveal.copied')}
      {testId}
    />

    <Dialog.Footer class="items-center">
      <Button variant="outline" size="sm" onclick={() => (open = false)}>
        {$t('automation.keys.reveal.close')}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
