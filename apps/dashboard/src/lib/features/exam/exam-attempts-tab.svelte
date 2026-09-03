<script lang="ts">
  import { goto } from '$app/navigation';
  import { t } from '$lib/utils/functions/translations';
  import { Button } from '@cio/ui/base/button';
  import * as Empty from '@cio/ui/base/empty';

  import ExamResultsTable from '$features/exam/exam-results-table.svelte';
  import type { ExamResultRow } from '$features/exam/exam-result-row';
  import { downloadFile, fileNameFromResponse } from '$features/exam/exam-file-download';
  import { classroomhub } from '$lib/utils/services/api';
  import { snackbar } from '$features/ui/snackbar/store';

  /**
   * What this class handed in, on the exam's own page.
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

  function openAttempt(attemptId: string) {
    // A navigation, not a page load: the rest of the dashboard moves between screens
    // without dropping client state, and a full reload here was the one place it did not.
    goto(`/courses/${courseId}/exams/${examId}/attempts/${attemptId}`);
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
  <div class="flex items-center justify-end">
    <Button variant="outline" size="sm" disabled={loading} onclick={refresh}>
      {loading ? $t('exam.results.loading') : $t('exam.results.reload')}
    </Button>
  </div>

  {#if failed || loadFailed}
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
