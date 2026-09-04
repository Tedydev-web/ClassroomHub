<script lang="ts">
  import { goto } from '$app/navigation';
  import { t } from '$lib/utils/functions/translations';
  import { Button } from '@cio/ui/base/button';
  import * as Empty from '@cio/ui/base/empty';

  import * as Tabs from '@cio/ui/base/tabs';

  import ExamResultsTable from '$features/exam/exam-results-table.svelte';
  import ExamAnswerSummary from '$features/exam/exam-answer-summary.svelte';
  import type { ExamResultRow } from '$features/exam/exam-result-row';
  import { downloadFile, fileNameFromResponse } from '$features/exam/exam-file-download';
  import { classroomhub } from '$lib/utils/services/api';
  import { snackbar } from '$features/ui/snackbar/store';

  /**
   * What this class handed in, in the two shapes an exercise's submissions tab already has.
   *
   * Summary answers "how did the class do, and which question did they fall for", which is
   * what a teacher reads before going through the paper in the room. Individual answers
   * "what did each of them get", which is the marking and invigilation view — the table,
   * with its filters, its selection and its downloads.
   *
   * The exam's table is richer than an exercise's list because a sitting has a clock and a
   * count of departures, but the question each mode answers is the same one, and that is
   * what makes the two screens read alike.
   *
   * The whole results screen, not a summary of it: the same table, the same marking states,
   * the same reopen, delete and workbook download. It belongs beside the paper and its
   * settings for the same reason an exercise's submissions belong beside its questions —
   * they are three views of one thing, and splitting them across pages is what made a
   * teacher hunt for the marks of the paper they were already looking at.
   */
  let {
    courseId,
    examId,
    rows: initialRows,
    failed = false
  }: {
    courseId: string;
    examId: string;
    rows: ExamResultRow[];
    /** The list could not be fetched. Saying nobody sat it would be a lie, not a default. */
    failed?: boolean;
  } = $props();
  /**
   * The loader's rows until something is fetched here. Seeding plain state from the loader
   * and leaving it would freeze at mount, so a teacher returning to this tab would read
   * whatever was true the first time they opened it.
   */
  type QuestionDistribution = {
    position: number;
    key: string;
    letters: string[];
    counts: Record<string, number>;
    blank: number;
    correct: number;
    answered: number;
  };

  type Mode = 'summary' | 'individual';
  let mode = $state<Mode>('summary');

  /**
   * The four numbers, above both modes rather than inside the table.
   *
   * They describe the class, not the list, so they belong to the tab: a teacher reading the
   * chart still wants to know how many are in and how many are waiting on a hand mark, and
   * making those appear and disappear with the mode would be the tab hiding facts about
   * itself.
   */
  const summary = $derived.by(() => {
    const finished = rows.filter((row) => row.status !== 'in_progress');
    const scored = finished.filter((row) => row.score !== null && row.gradingState === 'complete');
    const totalScore = scored.reduce((sum, row) => sum + Number(row.score ?? 0), 0);

    return {
      sat: rows.length,
      marked: finished.filter((row) => row.gradingState === 'complete').length,
      awaiting: rows.filter((row) => row.gradingState === 'awaiting_manual').length,
      average: scored.length > 0 ? (totalScore / scored.length).toFixed(1) : null,
      // Only when every scored sitting was marked out of the same number: re-opening an
      // exam re-freezes its paper, so a class can hold attempts scored out of different
      // totals, and taking the first row's would print an average over one denominator
      // beside a different one.
      outOf: new Set(scored.map((row) => row.total)).size === 1 ? (scored[0]?.total ?? null) : null
    };
  });

  /**
   * Fetched when the summary is first shown, not with the page.
   *
   * It reads every finished sitting's answers, which the results list deliberately does not
   * carry; loading it up front would make opening the exam pay for a screen the teacher may
   * never open.
   */
  let distribution = $state<QuestionDistribution[] | null>(null);
  let loadingSummary = $state(false);

  async function loadSummary() {
    if (distribution !== null || loadingSummary) return;

    loadingSummary = true;

    try {
      const response = await classroomhub.exam[':examId']['answer-distribution'].$get({ param: { examId } });
      const body = await response.json();

      if ('success' in body && body.success) distribution = body.data;
    } finally {
      loadingSummary = false;
    }
  }

  $effect(() => {
    if (mode === 'summary') void loadSummary();
  });

  let fetched = $state<ExamResultRow[] | null>(null);
  const rows = $derived(fetched ?? initialRows);
  let loading = $state(false);
  let loadFailed = $state(false);

  async function refresh() {
    loading = true;

    try {
      const response = await classroomhub.exam[':examId'].results.$get({ param: { examId } });
      const body = await response.json();

      if ('success' in body && body.success) {
        fetched = body.data;
        loadFailed = false;
      } else {
        loadFailed = true;
      }
    } catch {
      loadFailed = true;
    } finally {
      loading = false;
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

  /**
   * The answer sheets, opened in their own tab for the print dialog.
   *
   * A new tab rather than a navigation: the teacher is mid-way through reading the results
   * when they print, and coming back to a screen they had already scrolled and filtered is
   * the difference between printing once and printing three times.
   */
  function printAnswers(attemptIds: string[]) {
    const query = attemptIds.length > 0 ? `?attempts=${attemptIds.join(',')}` : '';

    window.open(`/courses/${courseId}/exams/${examId}/print${query}`, '_blank', 'noopener');
  }

  function openAttempt(attemptId: string) {
    // A navigation, not a page load: the rest of the dashboard moves between screens
    // without dropping client state, and a full reload here was the one place it did not.
    goto(`/courses/${courseId}/exams/${examId}/attempts/${attemptId}`);
  }

  /**
   * The class's answers, as a workbook a teacher takes into the room.
   *
   * Built and formatted on the server: the file is a zip of XML, and the browser has no
   * reason to carry a spreadsheet writer for one screen. The wording is the server's and is
   * always English — an export is mailed to a parent and opened by people who never see this
   * screen, so the file must not change shape with the language the screen was in.
   *
   * The name comes back with the file rather than being composed here — the server knows the
   * paper's title, which this page does not, and a folder full of files named after the
   * wrong thing is how the last attempt at this went.
   */
  let exportingAnswers = $state(false);

  async function exportAnswers(attemptIds: string[]) {
    exportingAnswers = true;

    try {
      const response = await classroomhub.exam[':examId']['answer-workbook'].$post({
        param: { examId },
        json: { attemptIds }
      });

      if (!response.ok) {
        snackbar.error($t('exam.results.export_failed'));
        return;
      }

      downloadFile(await response.blob(), fileNameFromResponse(response, 'answers.xlsx'));
      snackbar.success($t('exam.results.exported'));
    } catch {
      snackbar.error($t('exam.results.export_failed'));
    } finally {
      exportingAnswers = false;
    }
  }
</script>

<div class="space-y-4">
  <div class="flex items-center justify-end">
    <Button variant="outline" size="sm" disabled={loading} onclick={refresh}>
      {loading ? $t('exam.results.loading') : $t('exam.results.reload')}
    </Button>
  </div>

  <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
    {#snippet stat(label: string, value: string, accent = false)}
      <div class="border-border rounded-lg border px-3 py-2">
        <p class="text-muted-foreground text-xs">{label}</p>
        <p
          class={accent
            ? 'text-lg font-semibold text-amber-600 tabular-nums dark:text-amber-400'
            : 'text-lg font-semibold tabular-nums'}
        >
          {value}
        </p>
      </div>
    {/snippet}

    {@render stat($t('exam.results.summary_sat'), String(summary.sat))}
    {@render stat($t('exam.results.summary_marked'), String(summary.marked))}
    {@render stat($t('exam.results.awaiting_label'), String(summary.awaiting), summary.awaiting > 0)}
    {@render stat(
      $t('exam.results.summary_average'),
      summary.average === null ? '—' : summary.outOf ? `${summary.average}/${summary.outOf}` : summary.average
    )}
  </div>

  <Tabs.Root bind:value={mode} class="w-full">
    <Tabs.List class="grid w-full max-w-sm grid-cols-2">
      <Tabs.Trigger value="summary">{$t('exam.results.summary_mode')}</Tabs.Trigger>
      <Tabs.Trigger value="individual">{$t('exam.results.individual_mode')}</Tabs.Trigger>
    </Tabs.List>

    <Tabs.Content value="summary" class="pt-4">
      {#if loadingSummary && distribution === null}
        <p class="text-muted-foreground text-sm">{$t('exam.results.loading')}</p>
      {:else}
        <ExamAnswerSummary questions={distribution ?? []} />
      {/if}
    </Tabs.Content>

    <Tabs.Content value="individual" class="pt-4">
      {#if failed || loadFailed}
        <Empty.Root>
          <Empty.Content>
            <Empty.Description>{$t('exam.results.course_failed')}</Empty.Description>
          </Empty.Content>
        </Empty.Root>
      {:else}
        <ExamResultsTable
          {rows}
          showSummary={false}
          onopen={openAttempt}
          onreopen={reopen}
          ondelete={remove}
          onexportanswers={exportAnswers}
          onprintanswers={printAnswers}
          {exportingAnswers}
        />
      {/if}
    </Tabs.Content>
  </Tabs.Root>
</div>
