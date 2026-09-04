<script lang="ts">
  import { locale, t } from '$lib/utils/functions/translations';
  import { AuthUI } from '$features/ui';
  import { Button } from '@cio/ui/base/button';
  import * as Empty from '@cio/ui/base/empty';
  import ClockIcon from '@lucide/svelte/icons/clock';
  import LockIcon from '@lucide/svelte/icons/lock';
  import type { ExamWindowState } from '$features/exam/exam-window';
  import { parseWindowStamp } from '$features/exam/exam-window';

  /**
   * What a candidate meets when the paper is not theirs to start yet, or no longer is.
   *
   * Until now they met the form: name, class, password, Start — and only then a line of red
   * text saying the paper was not open. The work was wasted and the message arrived at the
   * worst possible moment, which for somebody sitting an exam is its own small cruelty.
   *
   * Deliberately the same shell as the entry form, not an error page: same card, same
   * background, same organisation logo. The paper is fine and so is the link; it is the
   * clock that is wrong, and a screen that looked like a crash would say otherwise.
   */
  let {
    state,
    title,
    opensAt = null,
    closesAt = null,
    supportContact = null
  }: {
    state: Exclude<ExamWindowState, 'open'>;
    title: string;
    opensAt?: string | null;
    closesAt?: string | null;
    supportContact?: string | null;
  } = $props();

  const moment = $derived(parseWindowStamp(state === 'before' ? opensAt : closesAt));

  /**
   * The full date, in the reader's own language and the room's own time zone.
   *
   * A candidate who has been told "not open" needs the one fact that follows from it: when.
   * A bare weekday would leave them guessing which week.
   */
  const when = $derived(
    moment
      ? new Intl.DateTimeFormat($locale, {
          weekday: 'long',
          day: '2-digit',
          month: 'long',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: 'Asia/Ho_Chi_Minh'
        }).format(moment)
      : null
  );
</script>

<AuthUI showOnlyContent showLogo>
  <Empty.Root class="ui:border-0 ui:bg-transparent ui:p-0">
    <Empty.Header>
      <Empty.Media variant="icon">
        {#if state === 'before'}
          <ClockIcon />
        {:else}
          <LockIcon />
        {/if}
      </Empty.Media>

      <Empty.Title>
        {state === 'before' ? $t('exam.window.not_open_yet') : $t('exam.window.closed')}
      </Empty.Title>

      <Empty.Description>
        {state === 'before' ? $t('exam.window.not_open_yet_body') : $t('exam.window.closed_body')}
      </Empty.Description>
    </Empty.Header>

    <Empty.Content class="ui:gap-4">
      <!--
        The paper's own name, so a candidate holding two links knows which one this is.
        Quiet rather than a second heading: the status is what they came here to learn.
      -->
      <p class="ui:text-foreground ui:text-sm ui:font-medium">{title}</p>

      {#if when}
        <div class="ui:bg-muted/60 ui:w-full ui:rounded-lg ui:px-4 ui:py-3">
          <p class="ui:text-muted-foreground ui:text-xs">
            {state === 'before' ? $t('exam.window.opens_label') : $t('exam.window.closed_label')}
          </p>
          <p class="ui:mt-1 ui:text-sm ui:font-medium ui:tabular-nums">{when}</p>
        </div>
      {/if}

      {#if supportContact}
        <p class="ui:text-muted-foreground ui:text-xs">
          {$t('exam.window.support', { contact: supportContact })}
        </p>
      {/if}

      {#if state === 'before'}
        <!--
          A reload rather than a countdown that flips itself: a candidate refreshing at the
          hour is a decision they make, and a page that started the paper on its own would
          start the clock on somebody who had walked away from the desk.
        -->
        <Button variant="outline" size="sm" onclick={() => location.reload()}>
          {$t('exam.window.check_again')}
        </Button>
      {/if}
    </Empty.Content>
  </Empty.Root>
</AuthUI>
