<script lang="ts">
  import { Button } from '@cio/ui/button';

  import ExamResultsTable from '$features/exam/exam-results-table.svelte';
  import { classroomhub } from '$lib/utils/services/api';
  import { snackbar } from '$lib/components/Snackbar/store';

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
    const minutes = Number(window.prompt('Cho làm tiếp bao nhiêu phút?', '15'));
    if (!Number.isFinite(minutes) || minutes <= 0) return;

    const response = await classroomhub.exam.attempt[':attemptId'].reopen.$post({
      param: { attemptId },
      json: { extraSeconds: Math.round(minutes * 60) }
    });

    if (response.ok) {
      snackbar.success('Đã cho làm tiếp');
      await refresh();
    } else {
      snackbar.error('Không mở lại được lượt làm này');
    }
  }

  function openAttempt(attemptId: string) {
    window.location.href = `/courses/${data.courseId}/exams/${data.examId}/attempts/${attemptId}`;
  }

  const sat = $derived(rows.length);
  const marked = $derived(rows.filter((row) => row.gradingState === 'complete').length);
  const awaiting = $derived(rows.filter((row) => row.gradingState === 'awaiting_manual').length);
</script>

<div class="ui:mx-auto ui:w-full ui:max-w-6xl ui:space-y-6 ui:px-4 ui:py-6">
  <header class="ui:flex ui:flex-wrap ui:items-center ui:justify-between ui:gap-3">
    <div>
      <h1 class="ui:text-xl ui:font-semibold">{data.exam.title}</h1>
      <p class="ui:text-muted-foreground ui:text-sm">
        {sat} lượt thi · {marked} đã chấm xong{awaiting > 0 ? ` · ${awaiting} chờ chấm tay` : ''}
      </p>
    </div>
    <Button variant="outline" disabled={refreshing} onclick={refresh}>
      {refreshing ? 'Đang tải…' : 'Tải lại'}
    </Button>
  </header>

  <ExamResultsTable {rows} onopen={openAttempt} onreopen={reopen} />
</div>
