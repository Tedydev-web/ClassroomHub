<script lang="ts">
  import { t } from '$lib/utils/functions/translations';
  import { Button } from '@cio/ui/base/button';
  import * as Page from '@cio/ui/base/page';

  import ExamResultsTable from '$features/exam/exam-results-table.svelte';
  import { classroomhub } from '$lib/utils/services/api';
  import { snackbar } from '$features/ui/snackbar/store';

  /**
   * The teacher's view of one paper.
   *
   * Loading this list is what finalises attempts whose clocks ran out, so a teacher never
   * sees a stale "đang thi" for a paper that ended yesterday. That happens on the server;
   * this page only has to ask.
   */
  let { data } = $props();

  /**
   * The loader is the source; `refreshed` only holds what the reload button fetched since.
   * Plain state seeded from the loader would freeze at mount and show stale results after
   * a navigation back to this page.
   */
  let refreshed = $state<typeof data.rows | null>(null);
  const rows = $derived(refreshed ?? data.rows);
  let refreshing = $state(false);

  async function refresh() {
    refreshing = true;

    try {
      const response = await classroomhub.exam[':examId'].results.$get({ param: { examId: data.examId } });
      const body = await response.json();

      if ('success' in body && body.success) refreshed = body.data;
    } finally {
      refreshing = false;
    }
  }

  async function reopen(attemptId: string) {
    const minutes = Number(window.prompt($t('exam.results.reopen_prompt'), '15'));
    if (!Number.isFinite(minutes) || minutes <= 0) return;

    const response = await classroomhub.exam.attempt[':attemptId'].reopen.$post({
      param: { attemptId },
      json: { extraSeconds: Math.round(minutes * 60) }
    });

    if (response.ok) {
      snackbar.success($t('exam.results.reopened'));
      await refresh();
    } else {
      snackbar.error($t('exam.results.reopen_failed'));
    }
  }

  async function remove(attemptId: string, displayName: string | null) {
    // Destructive and unrecoverable, so it asks — naming the sitter, because a teacher
    // clicking down a list of forty needs to see which paper they are about to destroy.
    if (!window.confirm($t('exam.results.delete_confirm', { name: displayName ?? '—' }))) return;

    const response = await classroomhub.exam.attempt[':attemptId'].$delete({ param: { attemptId } });

    if (response.ok) {
      snackbar.success($t('exam.results.deleted'));
      await refresh();
    } else {
      snackbar.error($t('exam.results.delete_failed'));
    }
  }

  function openAttempt(attemptId: string) {
    window.location.href = `/courses/${data.courseId}/exams/${data.examId}/attempts/${attemptId}`;
  }

  const sat = $derived(rows.length);
  const marked = $derived(rows.filter((row) => row.gradingState === 'complete').length);
  const awaiting = $derived(rows.filter((row) => row.gradingState === 'awaiting_manual').length);
</script>

<Page.Root class="mx-auto flex w-[calc(95vw-var(--sidebar-width))]!">
  <Page.Header>
    <Page.HeaderContent>
      <Page.Title>{data.exam.title}</Page.Title>
      <Page.Subtitle>
        {$t('exam.results.summary_line', { sat: String(sat), marked: String(marked) })}{awaiting > 0
          ? ` · ${$t('exam.results.summary_awaiting', { count: String(awaiting) })}`
          : ''}
      </Page.Subtitle>
    </Page.HeaderContent>
    <Page.Action>
      <Button variant="outline" disabled={refreshing} onclick={refresh}>
        {refreshing ? $t('exam.results.loading') : $t('exam.results.reload')}
      </Button>
    </Page.Action>
  </Page.Header>

  <Page.Body>
    {#snippet child()}
      <ExamResultsTable {rows} onopen={openAttempt} onreopen={reopen} ondelete={remove} />
    {/snippet}
  </Page.Body>
</Page.Root>
