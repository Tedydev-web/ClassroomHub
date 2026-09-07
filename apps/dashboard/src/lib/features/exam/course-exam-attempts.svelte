<script lang="ts">
  import { goto } from '$app/navigation';
  import { t } from '$lib/utils/functions/translations';
  import ExamAttemptsTab from '$features/exam/exam-attempts-tab.svelte';
  import ExamResultsTable from '$features/exam/exam-results-table.svelte';
  import type { ExamResultRow } from '$features/exam/exam-result-row';
  import { classroomhub } from '$lib/utils/services/api';
  import ExamExportControls from '$features/exam/exam-export-controls.svelte';
  import type { ExamExportLocale } from '$features/exam/exam-export-preferences';
  import { downloadFile, fileNameFromResponse } from '$features/exam/exam-file-download';
  import { snackbar } from '$features/ui/snackbar/store';
  import { Button } from '@cio/ui/base/button';
  import { Input } from '@cio/ui/base/input';
  import * as Empty from '@cio/ui/base/empty';

  /**
   * Every sitting handed in across the course.
   *
   * This tab used to render the exam list, which is what the exams page already is: a
   * teacher looking for what a class handed in was shown the papers instead, and the two
   * places disagreed about nothing because they were the same view twice. The exercises
   * tab beside this one lists submissions, so this lists sittings.
   *
   * Managing the papers themselves stays one button away rather than here.
   */
  type CourseAttemptRow = {
    attemptId: string;
    examId: string;
    examTitle: string;
    displayName: string | null;
    nickname: string | null;
    className: string | null;
    candidateNumber: string | null;
    status: 'in_progress' | 'submitted' | 'expired';
    expiresAt: string | null;
    gradingState: 'complete' | 'awaiting_manual' | 'unscoreable';
    score: string | null;
    total: string | null;
    startedAt: string;
    submittedAt: string | null;
    leaves: number;
    duplicateName: boolean;
    duplicateAddress: boolean;
  };

  let {
    courseId,
    attempts,
    failed = false
  }: {
    courseId: string;
    attempts: CourseAttemptRow[];
    /** The list could not be fetched. Saying nothing was sat would be a lie, not a default. */
    failed?: boolean;
  } = $props();

  let search = $state('');
  let examId = $state<'all' | string>('all');

  /**
   * Choosing one paper hands the tab over to the exam's own submissions view — the same
   * four numbers, filters, selection and downloads a teacher gets on the exam's page.
   *
   * "All exams" carries the same downloads, issued once per paper: a workbook is built from
   * one paper's key, so a selection spanning two papers is two files rather than none. What
   * it cannot carry is the per-question summary, which is a distribution over one paper's
   * questions and has no meaning across papers that share no question.
   */
  let rows = $state<ExamResultRow[] | null>(null);
  let loadingRows = $state(false);
  let rowsFailed = $state(false);

  async function chooseExam(id: 'all' | string) {
    examId = id;
    rows = null;
    rowsFailed = false;

    if (id === 'all') return;

    loadingRows = true;

    try {
      const response = await classroomhub.exam[':examId'].results.$get({ param: { examId: id } });
      const body = await response.json();

      if ('success' in body && body.success) rows = body.data;
      else rowsFailed = true;
    } catch {
      rowsFailed = true;
    } finally {
      loadingRows = false;
    }
  }

  /** The papers that actually have a sitting, in the order the rows arrive (newest first). */
  const exams = $derived(
    attempts
      .map((row) => ({ id: row.examId, title: row.examTitle }))
      .filter((exam, index, all) => all.findIndex((other) => other.id === exam.id) === index)
  );

  /**
   * A row here belongs to a paper of its own, so opening it needs that paper's id — which
   * is the one thing this list has that an exam's own results do not.
   *
   * Reopening and deleting route to the attempt as well. Both are destructive and both live
   * on the exam's own screen; from a list that spans papers, taking a teacher to the paper
   * is safer than acting on a row whose context they are not looking at.
   */
  function openAttempt(attemptId: string) {
    const row = attempts.find((candidate) => candidate.attemptId === attemptId);

    if (row) goto(`/courses/${courseId}/exams/${row.examId}/attempts/${attemptId}`);
  }

  const shown = $derived.by(() => {
    const needle = search.trim().toLowerCase();

    return attempts.filter((row) => {
      if (examId !== 'all' && row.examId !== examId) return false;
      if (needle === '') return true;

      // Matched against everything a teacher would type to find one person, so a class or
      // a candidate number finds them as readily as a name does.
      return [row.displayName, row.nickname, row.className, row.candidateNumber, row.examTitle]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(needle));
    });
  });

  let exportLocale = $state<ExamExportLocale>('en');
  let includeAnswerKey = $state(true);
  let exportingAnswers = $state(false);

  /**
   * The chosen sittings, split into the paper each one belongs to.
   *
   * Every export is built from one paper's key, so a selection reaching across papers is not
   * one file but one per paper. Grouping here rather than refusing the selection is what
   * lets a teacher tick down the whole course list and get what they asked for.
   */
  function attemptsByExam(attemptIds: string[]): Map<string, string[]> {
    const grouped = new Map<string, string[]>();

    for (const attemptId of attemptIds) {
      const row = attempts.find((candidate) => candidate.attemptId === attemptId);
      if (!row) continue;

      grouped.set(row.examId, [...(grouped.get(row.examId) ?? []), attemptId]);
    }

    return grouped;
  }

  async function exportAnswers(attemptIds: string[]) {
    const grouped = attemptsByExam(attemptIds);
    if (grouped.size === 0) return;

    exportingAnswers = true;

    try {
      let failures = 0;

      // One request per paper, in turn rather than at once: each response is a file the
      // browser starts saving, and a browser handed several downloads in the same tick asks
      // the teacher to permit them instead of saving them.
      for (const [id, ids] of grouped) {
        try {
          const response = await classroomhub.exam[':examId']['answer-workbook'].$post({
            param: { examId: id },
            json: { attemptIds: ids, locale: exportLocale }
          });

          if (!response.ok) {
            failures += 1;
            continue;
          }

          downloadFile(await response.blob(), fileNameFromResponse(response, 'answers.xlsx'));
        } catch {
          failures += 1;
        }
      }

      if (failures > 0) snackbar.error($t('exam.results.export_failed'));
      else snackbar.success($t('exam.results.exported'));
    } finally {
      exportingAnswers = false;
    }
  }

  /** The sheets for each paper in the selection, one tab per paper. */
  function printAnswers(attemptIds: string[]) {
    for (const [id, ids] of attemptsByExam(attemptIds)) {
      const query = `?lang=${exportLocale}` + (includeAnswerKey ? '' : '&key=off') + `&attempts=${ids.join(',')}`;

      window.open(`/courses/${courseId}/exams/${id}/print${query}`, '_blank', 'noopener');
    }
  }

  /** The course's sittings in the shape the shared results table reads, each naming its paper. */
  const courseRows = $derived(
    shown.map(
      (row): ExamResultRow => ({
        attemptId: row.attemptId,
        displayName: row.displayName,
        nickname: row.nickname,
        className: row.className,
        candidateNumber: row.candidateNumber,
        status: row.status,
        gradingState: row.gradingState,
        score: row.score,
        total: row.total,
        startedAt: row.startedAt,
        submittedAt: row.submittedAt,
        duplicateName: row.duplicateName,
        duplicateAddress: row.duplicateAddress,
        leaves: row.leaves,
        examId: row.examId,
        examTitle: row.examTitle
      })
    )
  );
</script>

<div class="space-y-4">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div class="flex flex-wrap items-center gap-2">
      {#if examId === 'all'}
        <Input class="w-56" placeholder={$t('exam.results.search_placeholder')} bind:value={search} />
      {/if}

      <Button size="sm" variant={examId === 'all' ? 'default' : 'outline'} onclick={() => chooseExam('all')}>
        {$t('exam.results.all_exams')}
      </Button>
      {#each exams as exam (exam.id)}
        <Button size="sm" variant={examId === exam.id ? 'default' : 'outline'} onclick={() => chooseExam(exam.id)}>
          {exam.title}
        </Button>
      {/each}
    </div>

    <Button variant="outline" size="sm" href={`/courses/${courseId}/exams`}>
      {$t('exam.results.manage_exams')}
    </Button>
  </div>

  {#if examId === 'all' && shown.length > 0}
    <ExamExportControls bind:locale={exportLocale} bind:includeAnswerKey />
  {/if}

  {#if examId !== 'all'}
    {#if loadingRows}
      <p class="text-muted-foreground text-sm">{$t('exam.results.loading')}</p>
    {:else}
      <ExamAttemptsTab {courseId} {examId} rows={rows ?? []} failed={rowsFailed} />
    {/if}
  {:else if failed}
    <Empty.Root>
      <Empty.Content>
        <Empty.Description>{$t('exam.results.course_failed')}</Empty.Description>
      </Empty.Content>
    </Empty.Root>
  {:else if shown.length === 0}
    <Empty.Root>
      <Empty.Content>
        <Empty.Description>{$t('exam.results.course_empty')}</Empty.Description>
      </Empty.Content>
    </Empty.Root>
  {:else}
    <!--
      The same table the exam's own results use, with the paper's title as one more column.
      A teacher looking across papers is doing the same work as one looking at a single
      paper — reading who sat, what they scored, who to open first — and until now the two
      screens answered that with two different tables.

      What this mode cannot have is the per-question summary, which is a distribution over
      one paper's questions. The workbook and the printed sheets it does have, issued once
      per paper in the selection.
    -->
    <ExamResultsTable
      rows={courseRows}
      onopen={openAttempt}
      onreopen={openAttempt}
      ondelete={openAttempt}
      onexportanswers={exportAnswers}
      onprintanswers={printAnswers}
      {exportingAnswers}
    />
  {/if}
</div>
