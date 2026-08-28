<script lang="ts">
  import EyeIcon from '@lucide/svelte/icons/eye';
  import { Button } from '@cio/ui/base/button';
  import * as Dialog from '@cio/ui/base/dialog';

  import { t } from '$lib/utils/functions/translations';

  /**
   * Shown when the paper becomes visible again after being hidden.
   *
   * Every word of it is generated from what the exam is actually configured to do. Where no
   * teacher switched enforcement on, it says the departure was recorded and who will see it
   * — which is true, happens every time, and therefore does not wear out. Where a teacher
   * did switch it on, it says how many departures remain.
   *
   * It never threatens a submission that will not happen. A warning that bluffs is a lie
   * told to a child in an exam room, and the teacher who relies on it finds out it was a
   * bluff at the same moment the class does.
   */
  let {
    open = false,
    leaves,
    autoSubmitAfterLeaves,
    onacknowledge
  }: {
    open?: boolean;
    /** How many times the paper has been left, this one included. */
    leaves: number;
    /** The teacher's limit, or `null` where they set none. */
    autoSubmitAfterLeaves: number | null;
    onacknowledge: () => void;
  } = $props();

  const remaining = $derived(autoSubmitAfterLeaves === null ? null : Math.max(0, autoSubmitAfterLeaves - leaves + 1));
</script>

<Dialog.Root {open} onOpenChange={(next) => !next && onacknowledge()}>
  <Dialog.Content class="ui:max-w-sm" onInteractOutside={(event) => event.preventDefault()}>
    <Dialog.Header>
      <Dialog.Title class="ui:flex ui:items-center ui:gap-2">
        <EyeIcon size={18} aria-hidden="true" />
        {$t('exam.left.title')}
      </Dialog.Title>
      <Dialog.Description>
        {$t('exam.left.recorded', { count: String(leaves) })}
      </Dialog.Description>
    </Dialog.Header>

    {#if remaining !== null}
      <p class="ui:text-destructive ui:text-sm ui:font-medium">
        {remaining > 0 ? $t('exam.left.remaining', { count: String(remaining) }) : $t('exam.left.last_chance')}
      </p>
    {/if}

    <Dialog.Footer>
      <Button onclick={onacknowledge}>{$t('exam.left.continue')}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
