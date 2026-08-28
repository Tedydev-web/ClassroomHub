<script lang="ts">
  import { Button } from '@cio/ui/base/button';
  import * as Dialog from '@cio/ui/base/dialog';

  import { t } from '$lib/utils/functions/translations';

  /**
   * The last thing between a candidate and handing in.
   *
   * Starting a paper asks for confirmation and finishing one did not, which had it exactly
   * backwards: opening the paper is recoverable and handing it in is not. Reaching the last
   * question and pressing the same Next button the candidate has pressed thirty-nine times
   * already submitted the paper outright.
   *
   * So the dialog exists, and it earns the tap it costs by answering the only question worth
   * asking at that moment — which ones did I leave blank. The unanswered numbers are the
   * dialog's real content and each one is a way back to that question; the buttons are
   * underneath them, because going back is the useful outcome and submitting is merely the
   * expected one.
   *
   * The clock running out does not come through here. That submit is the server's, the
   * candidate has no say in it, and a dialog nobody is left to answer would only stand
   * between their answers and the paper being handed in.
   */
  let {
    open = false,
    answered,
    total,
    unansweredNumbers,
    minutesLeft = null,
    submitting = false,
    error = null,
    oncancel,
    onconfirm,
    onjump
  }: {
    open?: boolean;
    answered: number;
    total: number;
    /** Every number still blank, in the order they appear on the paper. */
    unansweredNumbers: number[];
    minutesLeft?: number | null;
    submitting?: boolean;
    /** A refusal from the server, shown here because this dialog covers where it would go. */
    error?: string | null;
    oncancel: () => void;
    onconfirm: () => void;
    /** Closes the dialog and puts the candidate on that question. */
    onjump: (questionNumber: number) => void;
  } = $props();
</script>

<Dialog.Root {open} onOpenChange={(next) => !next && !submitting && oncancel()}>
  <Dialog.Content class="ui:max-h-[85vh] ui:max-w-md ui:overflow-y-auto">
    <Dialog.Header>
      <Dialog.Title>{$t('exam.submit_confirm.title')}</Dialog.Title>
      <Dialog.Description>
        {$t('exam.submit_confirm.answered_of', { answered: String(answered), total: String(total) })}
      </Dialog.Description>
    </Dialog.Header>

    <div class="ui:space-y-4">
      {#if unansweredNumbers.length > 0}
        <div class="ui:space-y-2">
          <p class="ui:text-destructive ui:text-sm ui:font-semibold">
            {$t('exam.submit_confirm.unanswered', { count: String(unansweredNumbers.length) })}
          </p>

          <!--
            Tappable, because a list of numbers a candidate cannot act on is a reproach
            rather than a help. Whichever one they press is where they are put.
          -->
          <div class="ui:flex ui:flex-wrap ui:gap-2">
            {#each unansweredNumbers as number (number)}
              <button
                type="button"
                class="ui:border-destructive ui:bg-destructive/10 ui:text-destructive ui:inline-flex ui:h-10 ui:min-w-10 ui:items-center ui:justify-center ui:rounded-md ui:border ui:px-2 ui:text-sm ui:font-medium"
                onclick={() => onjump(number)}
              >
                {number}
              </button>
            {/each}
          </div>

          <p class="ui:text-muted-foreground ui:text-xs">{$t('exam.submit_confirm.jump_hint')}</p>
        </div>
      {:else}
        <p class="ui:text-sm">{$t('exam.submit_confirm.all_answered')}</p>
      {/if}

      <!--
        Said here because it is the fact that decides the question. Handing in with time left
        is a choice; handing in with two minutes left is a different choice.
      -->
      {#if minutesLeft !== null && minutesLeft > 0}
        <p class="ui:text-muted-foreground ui:text-sm">
          {$t('exam.submit_confirm.time_left', { minutes: String(minutesLeft) })}
        </p>
      {/if}

      <p class="ui:text-muted-foreground ui:text-sm">{$t('exam.submit_confirm.final')}</p>

      <!--
        Shown inside the dialog rather than behind it. The paper's own error line lives in
        the action bar, which this dialog covers — a refusal reported there while this is
        open is a candidate pressing a button and watching nothing happen, which is a
        mistake this exam has already made once.
      -->
      {#if error}
        <p class="ui:text-destructive ui:text-sm" role="alert">{error}</p>
      {/if}
    </div>

    <Dialog.Footer>
      <Button variant="ghost" disabled={submitting} onclick={oncancel}>
        {$t('exam.submit_confirm.keep_working')}
      </Button>
      <Button disabled={submitting} onclick={onconfirm}>
        {submitting ? $t('exam.submit_confirm.submitting') : $t('exam.submit_confirm.submit')}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
