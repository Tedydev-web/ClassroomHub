<script lang="ts">
  import { browser } from '$app/environment';
  import { invalidateAll } from '$app/navigation';
  import { t } from '$lib/utils/functions/translations';
  import { classroomhub } from '$lib/utils/services/api';
  import { snackbar } from '$features/ui/snackbar/store';
  import { shareLink } from '$lib/utils/functions/share-link';
  import { Button } from '@cio/ui/base/button';
  import { Input } from '@cio/ui/base/input';
  import * as Dialog from '@cio/ui/base/dialog';

  /**
   * What a teacher can do with an exam from its own page: open it, hand out its link,
   * close it, and open it again.
   *
   * These actions used to exist only on the course's submissions list, so a teacher who had
   * just built an exam and landed on its page found a "Draft" badge and no way to change it.
   * Opening freezes the paper, so it goes through a confirmation that shows the paper's
   * shape first — the check that once would have caught forty questions published with
   * seventeen answer keys missing.
   */
  let {
    exam
  }: {
    exam: { id: string; status: string; slug: string | null };
  } = $props();

  let busy = $state(false);
  let confirming = $state(false);
  let summary = $state<{
    questionCount: number;
    questionsWithoutAnswerKey: Array<{ order: number; title: string }>;
  } | null>(null);

  // The host the teacher is on, which on an organisation site is that organisation's own
  // domain — the same address the submissions list copies. Read in the browser only.
  const examLink = $derived(browser && exam.slug ? `${window.location.origin}/exam/${exam.slug}` : '');

  async function startOpening() {
    confirming = true;
    summary = null;

    const response = await classroomhub.exam[':examId'].summary.$get({ param: { examId: exam.id } });
    const body = await response.json();

    if ('success' in body && body.success) {
      summary = body.data;
    } else {
      // Advisory, but a check that silently did not run reads like a paper with nothing wrong.
      snackbar.error($t('exam.manage.check_failed'));
    }
  }

  async function run(action: 'open' | 'close', successKey: string, failureKey: string) {
    busy = true;

    try {
      const response = await classroomhub.exam[':examId'][action].$post({ param: { examId: exam.id } });

      if (response.ok) {
        snackbar.success($t(successKey));
        confirming = false;
        await invalidateAll();
      } else {
        const body = await response.json();
        snackbar.error('error' in body ? String(body.error) : $t(failureKey));
      }
    } finally {
      busy = false;
    }
  }

  async function copyLink() {
    if ((await shareLink(examLink)) === 'copied') snackbar.success($t('exam.manage.link_copied'));
  }
</script>

<div class="ui:flex ui:flex-wrap ui:items-center ui:gap-2">
  {#if exam.status === 'draft'}
    <Button disabled={busy} onclick={startOpening}>{$t('exam.manage.open_exam')}</Button>
  {:else if exam.status === 'open'}
    {#if examLink}
      <Input
        readonly
        value={examLink}
        aria-label={$t('exam.manage.exam_link')}
        class="ui:w-72 ui:max-w-full"
        onfocus={(event) => event.currentTarget.select()}
      />
      <Button onclick={copyLink}>{$t('exam.manage.copy_link')}</Button>
    {/if}
    <Button
      variant="outline"
      disabled={busy}
      onclick={() => run('close', 'exam.manage.closed_notice', 'exam.manage.close_failed')}
    >
      {$t('exam.manage.close_exam')}
    </Button>
  {:else if exam.status === 'closed'}
    <!-- The paper sat so far keeps its snapshot, so re-opening cannot change what was marked. -->
    <Button disabled={busy} onclick={() => run('open', 'exam.manage.opened_notice', 'exam.manage.open_failed')}>
      {$t('exam.manage.reopen_exam')}
    </Button>
  {/if}
</div>

<Dialog.Root open={confirming} onOpenChange={(open) => !open && (confirming = false)}>
  <Dialog.Content class="ui:sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>{$t('exam.manage.open_confirm_title')}</Dialog.Title>
      <Dialog.Description>{$t('exam.manage.open_confirm_description')}</Dialog.Description>
    </Dialog.Header>

    {#if summary}
      {@const missing = summary.questionsWithoutAnswerKey}
      <div
        class={missing.length > 0
          ? 'ui:rounded-md ui:border ui:p-3 ui:text-sm border-amber-500/40 bg-amber-500/10'
          : 'ui:bg-muted ui:rounded-md ui:p-3 ui:text-sm'}
      >
        <p class="ui:font-medium">{$t('exam.manage.question_count', { count: String(summary.questionCount) })}</p>
        {#if missing.length > 0}
          <p class="ui:mt-1 ui:font-medium ui:dark:text-amber-300 text-amber-700">
            {$t('exam.manage.missing_keys', {
              count: String(missing.length),
              questions: missing.map((question) => question.order).join(', ')
            })}
          </p>
          <p class="ui:text-muted-foreground ui:mt-1">{$t('exam.manage.missing_keys_note')}</p>
        {:else}
          <p class="ui:text-muted-foreground ui:mt-1">{$t('exam.manage.all_keys_present')}</p>
        {/if}
      </div>
    {:else}
      <p class="ui:text-muted-foreground ui:text-sm">{$t('exam.manage.checking_paper')}</p>
    {/if}

    <Dialog.Footer>
      <Button variant="outline" onclick={() => (confirming = false)}>{$t('exam.manage.cancel')}</Button>
      <Button
        disabled={busy || !summary || summary.questionCount === 0}
        onclick={() => run('open', 'exam.manage.opened_notice', 'exam.manage.open_failed')}
      >
        {$t('exam.manage.open_exam')}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
