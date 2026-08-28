<script lang="ts">
  import ClockIcon from '@lucide/svelte/icons/clock';
  import EyeIcon from '@lucide/svelte/icons/eye';
  import ListChecksIcon from '@lucide/svelte/icons/list-checks';
  import RepeatIcon from '@lucide/svelte/icons/repeat';
  import { Button } from '@cio/ui/base/button';
  import * as Dialog from '@cio/ui/base/dialog';

  import { t } from '$lib/utils/functions/translations';

  /**
   * The last thing between a candidate and their clock.
   *
   * Starting used to happen the instant the entry form validated, so a student filling in
   * their name had already started the paper by the time they read the first question. The
   * clock is the one thing on this screen that cannot be given back, and it should not
   * start by accident.
   *
   * There is nothing behind this to hide: the paper is fetched by the request this dialog
   * triggers, so until the candidate confirms, no question exists on this device to be read
   * early or dug out of the page. That is a property of the flow, not of a blur.
   *
   * It also carries the monitoring notice, because that is the honest place for it —
   * before anything is recorded, not in terms nobody reads.
   */
  let {
    title,
    workingMinutes,
    questionCount,
    maxAttempts,
    starting = false,
    open = false,
    oncancel,
    onconfirm
  }: {
    title: string;
    workingMinutes: number | null;
    questionCount: number;
    maxAttempts: number | null;
    starting?: boolean;
    open?: boolean;
    oncancel: () => void;
    onconfirm: () => void;
  } = $props();
</script>

<Dialog.Root {open} onOpenChange={(next) => !next && !starting && oncancel()}>
  <Dialog.Content class="ui:max-w-md">
    <Dialog.Header>
      <Dialog.Title>{title}</Dialog.Title>
      <Dialog.Description>{$t('exam.start.description')}</Dialog.Description>
    </Dialog.Header>

    <ul class="ui:space-y-3 ui:text-sm">
      <li class="ui:flex ui:items-start ui:gap-3">
        <ClockIcon size={18} class="ui:text-muted-foreground ui:mt-0.5 ui:shrink-0" aria-hidden="true" />
        <span>
          {workingMinutes === null
            ? $t('exam.start.no_time_limit')
            : $t('exam.start.working_minutes', { minutes: String(workingMinutes) })}
        </span>
      </li>

      {#if questionCount > 0}
        <li class="ui:flex ui:items-start ui:gap-3">
          <ListChecksIcon size={18} class="ui:text-muted-foreground ui:mt-0.5 ui:shrink-0" aria-hidden="true" />
          <span>{$t('exam.start.question_count', { count: String(questionCount) })}</span>
        </li>
      {/if}

      <li class="ui:flex ui:items-start ui:gap-3">
        <RepeatIcon size={18} class="ui:text-muted-foreground ui:mt-0.5 ui:shrink-0" aria-hidden="true" />
        <span>
          {maxAttempts === null
            ? $t('exam.start.unlimited_attempts')
            : $t('exam.start.attempts', { count: String(maxAttempts) })}
        </span>
      </li>

      <!--
        Said before anything is recorded, in the words it is actually recorded in. A count
        of how often the paper lost focus is what the teacher sees; it is not a verdict, and
        the notice does not pretend otherwise.
      -->
      <li class="ui:flex ui:items-start ui:gap-3">
        <EyeIcon size={18} class="ui:text-muted-foreground ui:mt-0.5 ui:shrink-0" aria-hidden="true" />
        <span class="ui:text-muted-foreground">{$t('exam.start.monitoring_notice')}</span>
      </li>
    </ul>

    <p class="ui:text-muted-foreground ui:text-sm ui:font-medium">{$t('exam.start.clock_warning')}</p>

    <Dialog.Footer>
      <Button variant="ghost" disabled={starting} onclick={oncancel}>{$t('exam.start.back')}</Button>
      <Button disabled={starting} onclick={onconfirm}>
        {starting ? $t('exam.start.starting') : $t('exam.start.begin')}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
