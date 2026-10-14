<script lang="ts">
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { t } from '$lib/utils/functions/translations';
  import { Badge } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import * as Alert from '@cio/ui/base/alert';
  import * as Page from '@cio/ui/base/page';
  import * as UnderlineTabs from '@cio/ui/custom/underline-tabs';

  import ExamPaperTab from '$features/exam/exam-paper-tab.svelte';
  import ExamSettingsForm from '$features/exam/exam-settings-form.svelte';
  import ExamAttemptsTab from '$features/exam/exam-attempts-tab.svelte';
  import ExamStatusActions from '$features/exam/exam-status-actions.svelte';
  import { classroomhub } from '$lib/utils/services/api';
  import { snackbar } from '$features/ui/snackbar/store';

  /**
   * One exam, three tabs, the way one exercise already works.
   *
   * The tab lives in `?tab=` rather than in the path, which is what an exercise does: it
   * makes a tab linkable without turning each one into a route, and it lets the four
   * addresses this screen replaced redirect to the exact tab they used to be.
   */
  let { data } = $props();

  type ExamTab = 'paper' | 'settings' | 'submissions';

  function normalise(value: string | null): ExamTab {
    return value === 'settings' || value === 'submissions' ? value : 'paper';
  }

  let tab = $state<ExamTab>(normalise(page.url.searchParams.get('tab')));

  function select(value: string) {
    const next = normalise(value);
    if (next === tab) return;

    tab = next;
    // Replaced rather than pushed: a teacher moving between tabs of one exam is not
    // navigating, and making the back button walk back through four tabs before leaving
    // the exam is the behaviour that would follow from pushing.
    replaceState(`/courses/${data.courseId}/exams/${data.examId}?tab=${next}`, {});
  }

  const STATUS_LABEL: Record<string, string> = $derived({
    draft: $t('exam.manage.draft'),
    open: $t('exam.manage.open'),
    closed: $t('exam.manage.closed')
  });

  let submitting = $state(false);

  async function saveSettings(settings: Record<string, unknown>) {
    submitting = true;

    try {
      const response = await classroomhub.exam[':examId'].$patch({
        param: { examId: data.examId },
        json: settings
      });
      const body = await response.json();

      if ('success' in body && body.success) {
        snackbar.success($t('exam.settings.updated'));
      } else {
        snackbar.error('error' in body ? String(body.error) : $t('exam.settings.update_failed'));
      }
    } finally {
      submitting = false;
    }
  }

  const settings = $derived({
    title: data.exam.title,
    mode: data.exam.mode,
    workingSeconds: data.exam.workingSeconds,
    opensAt: data.exam.opensAt,
    closesAt: data.exam.closesAt,
    maxAttempts: data.exam.maxAttempts,
    requiresName: data.exam.requiresName,
    requiresClass: data.exam.requiresClass,
    requiresCandidateNumber: data.exam.requiresCandidateNumber,
    scoreVisibility: data.exam.scoreVisibility,
    answerVisibility: data.exam.answerVisibility,
    commentVisibility: data.exam.commentVisibility,
    revealThreshold: data.exam.revealThreshold,
    hasPassword: data.exam.hasPassword,
    autoSubmitAfterLeaves: data.exam.autoSubmitAfterLeaves,
    supportContact: data.exam.supportContact,
    startWindowMinutes: data.exam.startWindowMinutes,
    shuffleQuestions: data.exam.shuffleQuestions,
    shuffleOptions: data.exam.shuffleOptions,
    holdSharedDevice: data.exam.holdSharedDevice,
    watermark: data.exam.watermark
  });
</script>

<Page.Root class="mx-auto flex w-full md:w-[calc(95vw-var(--sidebar-width))]!">
  <Page.Header>
    <Page.HeaderContent>
      <Page.Title>{data.exam.title}</Page.Title>
      <Badge variant={data.exam.status === 'open' ? 'default' : 'secondary'}>
        {STATUS_LABEL[data.exam.status] ?? data.exam.status}
      </Badge>
    </Page.HeaderContent>
    <Page.Action>
      <ExamStatusActions exam={data.exam} />
    </Page.Action>
  </Page.Header>

  <Page.Body>
    {#snippet child()}
      <UnderlineTabs.Root value={tab} onValueChange={select} class="mb-4">
        <UnderlineTabs.List class="grid w-full max-w-lg grid-cols-3">
          <UnderlineTabs.Trigger value="paper">{$t('exam.manage.paper_tab')}</UnderlineTabs.Trigger>
          <UnderlineTabs.Trigger value="settings">{$t('exam.manage.settings_tab')}</UnderlineTabs.Trigger>
          <UnderlineTabs.Trigger value="submissions">
            {$t('course.navItem.submissions.title')}
            <Badge variant="outline">{data.rows.length}</Badge>
          </UnderlineTabs.Trigger>
        </UnderlineTabs.List>

        <UnderlineTabs.Content value="paper" class="w-full">
          <!--
            One line about where the questions live. A draft shows its questions live from the
            source exercise and is edited there; an opened exam shows the copy it froze, where
            only the answer key can still be corrected (which re-marks the class).
          -->
          <div class="ui:border-border mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border p-4">
            <p class="ui:text-muted-foreground text-sm">
              {$t(data.paperFrozen ? 'exam.settings.edit_questions_hint_frozen' : 'exam.settings.draft_paper_note')}
            </p>
            {#if data.exam.exerciseId && !data.paperFrozen}
              <Button variant="secondary" href={`/courses/${data.courseId}/exercises/${data.exam.exerciseId}`}>
                {$t('exam.settings.edit_questions')}
              </Button>
            {/if}
          </div>

          <ExamPaperTab examId={data.examId} questions={data.questions} paper={data.paper} frozen={data.paperFrozen} />
        </UnderlineTabs.Content>

        <UnderlineTabs.Content value="settings">
          <div class="mx-auto w-full max-w-3xl space-y-6">
            <Alert.Root>
              <Alert.Description>{$t('exam.settings.live_notice')}</Alert.Description>
            </Alert.Root>

            <ExamSettingsForm
              {submitting}
              initial={settings}
              submitLabel={$t('exam.settings.save_changes')}
              onsubmit={saveSettings}
            />
          </div>
        </UnderlineTabs.Content>

        <UnderlineTabs.Content value="submissions">
          <ExamAttemptsTab courseId={data.courseId} examId={data.examId} rows={data.rows} failed={data.rowsFailed} />
        </UnderlineTabs.Content>
      </UnderlineTabs.Root>
    {/snippet}
  </Page.Body>
</Page.Root>
