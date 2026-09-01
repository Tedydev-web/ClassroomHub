<script lang="ts">
  import { t } from '$lib/utils/functions/translations';
  import { Button } from '@cio/ui/base/button';
  import * as Page from '@cio/ui/base/page';

  import ExamTabs from '$features/exam/exam-tabs.svelte';
  import ExamResultsTable from '$features/exam/exam-results-table.svelte';
  import { buildAnswerMatrixCsv, downloadCsv } from '$features/exam/exam-answer-sheet-csv';
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

  /**
   * The class's answers, as a sheet a teacher can go through the paper from.
   *
   * A column per question and a row per candidate, with the key on the first row. Read down
   * a column and it says which question the class fell for and what they chose instead; read
   * across a row and it is one candidate's paper. The register export beside it says who sat
   * and what they scored, which is a different question and not this one.
   *
   * Fetched only when asked. The results list deliberately carries no answers — four hundred
   * sittings of them is not a page — so they are collected here and nowhere else.
   */
  let exportingAnswers = $state(false);

  async function exportAnswers(attemptIds: string[]) {
    exportingAnswers = true;

    try {
      const response = await classroomhub.exam[':examId']['answer-matrix'].$post({
        param: { examId: data.examId },
        json: { attemptIds }
      });
      const body = await response.json();

      if (!('success' in body) || !body.success) {
        snackbar.error($t('exam.results.export_failed'));
        return;
      }

      downloadCsv(
        buildAnswerMatrixCsv(body.data, {
          name: $t('exam.entry.full_name'),
          nickname: $t('exam.entry.nickname'),
          className: $t('exam.entry.class_name'),
          candidateNumber: $t('exam.entry.candidate_number'),
          score: $t('exam.results.score_column'),
          correct: $t('exam.results.correct_column'),
          question: $t('exam.results.question_short'),
          key: $t('exam.corrections.current_key')
        }),
        `${data.title}-${$t('exam.results.answers_file')}.csv`
      );

      snackbar.success($t('exam.results.exported'));
    } catch {
      snackbar.error($t('exam.results.export_failed'));
    } finally {
      exportingAnswers = false;
    }
  }
</script>

<Page.Root class="mx-auto flex w-full md:w-[calc(95vw-var(--sidebar-width))]!">
  <Page.Header>
    <Page.HeaderContent>
      <Page.Title>{data.exam.title}</Page.Title>
      <!--
        Context, not counts. The table below states how many sat, how many are marked and
        how many wait on a hand mark; repeating them here made the same four numbers appear
        twice on one screen, in two different shapes.
      -->
      <Page.Subtitle>{$t('exam.manage.results')}</Page.Subtitle>
    </Page.HeaderContent>
    <Page.Action>
      <Button variant="outline" disabled={refreshing} onclick={refresh}>
        {refreshing ? $t('exam.results.loading') : $t('exam.results.reload')}
      </Button>
    </Page.Action>
  </Page.Header>

  <Page.Body>
    {#snippet child()}
      <ExamTabs courseId={data.courseId} examId={data.examId} />
      <ExamResultsTable
        {rows}
        onopen={openAttempt}
        onreopen={reopen}
        ondelete={remove}
        onexportanswers={exportAnswers}
        {exportingAnswers}
      />
    {/snippet}
  </Page.Body>
</Page.Root>
