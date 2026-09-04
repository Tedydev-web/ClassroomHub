<script lang="ts">
  import { goto } from '$app/navigation';
  import { t } from '$lib/utils/functions/translations';
  import ExamAttemptsTab from '$features/exam/exam-attempts-tab.svelte';
  import ExamResultsTable from '$features/exam/exam-results-table.svelte';
  import type { ExamResultRow } from '$features/exam/exam-result-row';
  import { classroomhub } from '$lib/utils/services/api';
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
   * "All exams" cannot show those: the average of two different papers is a number that
   * means nothing, and a workbook is built from one paper's key. So that mode stays the
   * plain cross-course list, which answers the different question of who handed in what.
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

      What this mode cannot have is what belongs to one paper: no summary of what the class
      chose per question, and no workbook or printed sheets, both built from one paper's key.
    -->
    <ExamResultsTable rows={courseRows} onopen={openAttempt} onreopen={openAttempt} ondelete={openAttempt} />
  {/if}
</div>
