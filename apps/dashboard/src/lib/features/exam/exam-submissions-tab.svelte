<script lang="ts">
  import { replaceState } from '$app/navigation';
  import { t } from '$lib/utils/functions/translations';
  import { Button } from '@cio/ui/base/button';
  import * as Empty from '@cio/ui/base/empty';

  import ExamResultsTable from '$features/exam/exam-results-table.svelte';
  import type { ExamResultRow } from '$features/exam/exam-result-row';
  import { downloadFile, fileNameFromResponse } from '$features/exam/exam-file-download';
  import { classroomhub } from '$lib/utils/services/api';
  import { snackbar } from '$features/ui/snackbar/store';

  /**
   * What the class handed in, one paper at a time.
   *
   * This is the exam results screen itself, not a summary of it: the same table, the same
   * marking states, the same reopen, delete and workbook download. It used to live on a
   * page of its own, reached from the sidebar, while this tab showed a thinner list built
   * for the same purpose — two screens answering one question and disagreeing in the
   * details. The thin one is gone and the real one moved here.
   *
   * A paper is chosen rather than merged: the numbers above the table — how many sat, how
   * many are marked, the average out of what — are properties of one paper, and averaging
   * two different papers' marks together produces a figure that means nothing.
   */
  type ExamOption = { id: string; title: string };

  let {
    courseId,
    exams,
    examId: initialExamId,
    rows: initialRows,
    failed = false
  }: {
    courseId: string;
    exams: ExamOption[];
    /** The paper the address named, or the newest one. Null when the course has no exams. */
    examId: string | null;
    rows: ExamResultRow[];
    /** The list could not be fetched. Saying nobody sat it would be a lie, not a default. */
    failed?: boolean;
  } = $props();

  let examId = $state(initialExamId);
  /**
   * The loader's rows until something is fetched here. Seeding plain state from the loader
   * and leaving it would freeze at mount, so a teacher returning to this tab would read
   * whatever was true the first time they opened it.
   */
  let fetched = $state<ExamResultRow[] | null>(null);
  const rows = $derived(examId === initialExamId && fetched === null ? initialRows : (fetched ?? []));
  let loading = $state(false);
  let loadFailed = $state(false);

  async function load(id: string) {
    loading = true;

    try {
      const response = await classroomhub.exam[':examId'].results.$get({ param: { examId: id } });
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

  /**
   * The chosen paper goes in the address, so the tab can be linked to and so the old
   * per-exam results URL has somewhere to redirect to that shows the same thing.
   */
  function choose(id: string) {
    if (id === examId) return;

    examId = id;
    fetched = null;
    replaceState(`/courses/${courseId}/submissions?exam=${id}`, {});
    load(id);
  }

  async function refresh() {
    if (examId) await load(examId);
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
    window.location.href = `/courses/${courseId}/exams/${examId}/attempts/${attemptId}`;
  }

  /**
   * The class's answers, as a workbook a teacher takes into the room.
   *
   * Built and formatted on the server: the file is a zip of XML, and the browser has no
   * reason to carry a spreadsheet writer for one screen. The wording travels with the
   * request, because the sheet is read by a teacher and their class and the server has no
   * idea which language that is.
   *
   * The name comes back with the file rather than being composed here — the server knows the
   * paper's title, which this page does not, and a folder full of files named after the
   * wrong thing is how the last attempt at this went.
   */
  let exportingAnswers = $state(false);

  async function exportAnswers(attemptIds: string[]) {
    if (!examId) return;

    exportingAnswers = true;

    try {
      const response = await classroomhub.exam[':examId']['answer-workbook'].$post({
        param: { examId },
        json: {
          attemptIds,
          labels: {
            paper: $t('exam.results.workbook_paper'),
            classSheet: $t('exam.results.workbook_class_sheet'),
            student: $t('exam.results.workbook_student'),
            className: $t('exam.entry.class_name'),
            score: $t('exam.results.score_column'),
            correctCount: $t('exam.results.correct_column'),
            question: $t('exam.results.question_short'),
            key: $t('exam.results.workbook_key'),
            theirAnswer: $t('exam.results.workbook_their_answer'),
            outcome: $t('exam.results.workbook_outcome'),
            right: $t('exam.results.workbook_right'),
            wrong: $t('exam.results.workbook_wrong'),
            blank: $t('exam.results.workbook_blank'),
            generatedAt: $t('exam.results.workbook_generated_at')
          }
        }
      });

      if (!response.ok) {
        snackbar.error($t('exam.results.export_failed'));
        return;
      }

      downloadFile(await response.blob(), fileNameFromResponse(response, $t('exam.results.answers_file')));
      snackbar.success($t('exam.results.exported'));
    } catch {
      snackbar.error($t('exam.results.export_failed'));
    } finally {
      exportingAnswers = false;
    }
  }
</script>

<div class="space-y-4">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div class="flex flex-wrap gap-2">
      {#each exams as exam (exam.id)}
        <Button size="sm" variant={examId === exam.id ? 'default' : 'outline'} onclick={() => choose(exam.id)}>
          {exam.title}
        </Button>
      {/each}
    </div>

    <div class="flex items-center gap-2">
      <Button variant="outline" size="sm" disabled={loading} onclick={refresh}>
        {loading ? $t('exam.results.loading') : $t('exam.results.reload')}
      </Button>
      <Button variant="outline" size="sm" href={`/courses/${courseId}/exams`}>
        {$t('exam.results.manage_exams')}
      </Button>
    </div>
  </div>

  {#if examId === null}
    <Empty.Root>
      <Empty.Content>
        <Empty.Description>{$t('exam.manage.empty')}</Empty.Description>
      </Empty.Content>
    </Empty.Root>
  {:else if failed || loadFailed}
    <Empty.Root>
      <Empty.Content>
        <Empty.Description>{$t('exam.results.course_failed')}</Empty.Description>
      </Empty.Content>
    </Empty.Root>
  {:else}
    <ExamResultsTable
      {rows}
      onopen={openAttempt}
      onreopen={reopen}
      ondelete={remove}
      onexportanswers={exportAnswers}
      {exportingAnswers}
    />
  {/if}
</div>
