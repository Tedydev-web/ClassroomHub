<script lang="ts">
  import { Badge } from '@cio/ui/badge';
  import { Button } from '@cio/ui/button';

  /**
   * Who sat the paper, how far they got, and what they scored.
   *
   * The status words are the ones Vietnamese teachers already read in Azota, with one
   * deliberate exception. Azota's `chưa nộp bài` means a student who left **before** time
   * was up and may still come back; ours would mean the clock ran out, which is the
   * opposite situation. Borrowing the phrase would teach the wrong thing precisely because
   * it is already familiar, so the expired case says `hết giờ (chưa nộp)` instead.
   */
  export type ExamResultRow = {
    attemptId: string;
    displayName: string | null;
    className: string | null;
    candidateNumber: string | null;
    status: 'in_progress' | 'submitted' | 'expired';
    gradingState: 'complete' | 'awaiting_manual' | 'unscoreable';
    score: string | null;
    total: string | null;
    startedAt: string;
    submittedAt: string | null;
    duplicateName: boolean;
    duplicateAddress: boolean;
  };

  let {
    rows,
    onopen,
    onreopen
  }: {
    rows: ExamResultRow[];
    onopen: (attemptId: string) => void;
    onreopen: (attemptId: string) => void;
  } = $props();

  type Filter = 'all' | 'in_progress' | 'expired' | 'submitted' | 'awaiting_manual';
  let filter = $state<Filter>('all');

  const FILTERS: Array<{ value: Filter; label: string }> = [
    { value: 'all', label: 'Tất cả' },
    { value: 'in_progress', label: 'Đang thi' },
    { value: 'expired', label: 'Hết giờ (chưa nộp)' },
    { value: 'submitted', label: 'Đã nộp' },
    { value: 'awaiting_manual', label: 'Chưa chấm' }
  ];

  const shown = $derived(
    rows.filter((row) => {
      if (filter === 'all') return true;
      if (filter === 'awaiting_manual') return row.gradingState === 'awaiting_manual';
      return row.status === filter;
    })
  );

  function statusLabel(row: ExamResultRow): string {
    if (row.gradingState === 'unscoreable') return 'Lỗi, cần xem lại';
    if (row.gradingState === 'awaiting_manual') return 'Chưa chấm';
    if (row.status === 'in_progress') return 'Đang thi';
    if (row.status === 'expired') return 'Hết giờ (chưa nộp)';
    return 'Đã nộp';
  }

  function scoreLabel(row: ExamResultRow): string {
    if (row.score === null || row.total === null) return '—';

    const suffix = row.gradingState === 'awaiting_manual' ? ' (chưa chấm hết)' : '';
    return `${row.score}/${row.total}${suffix}`;
  }

  function minutesTaken(row: ExamResultRow): string {
    if (!row.submittedAt) return '—';

    const minutes = Math.max(
      0,
      Math.round((new Date(row.submittedAt).getTime() - new Date(row.startedAt).getTime()) / 60_000)
    );
    return `${minutes} phút`;
  }
</script>

<div class="ui:space-y-4">
  <div class="ui:flex ui:flex-wrap ui:gap-2">
    {#each FILTERS as option (option.value)}
      <Button
        size="sm"
        variant={filter === option.value ? 'default' : 'outline'}
        onclick={() => (filter = option.value)}
      >
        {option.label}
      </Button>
    {/each}
  </div>

  {#if shown.length === 0}
    <p class="ui:text-muted-foreground ui:py-8 ui:text-center ui:text-sm">Chưa có ai làm bài.</p>
  {:else}
    <div class="ui:overflow-x-auto">
      <table class="ui:w-full ui:min-w-3xl ui:text-sm">
        <thead class="ui:border-border ui:text-muted-foreground ui:border-b ui:text-left ui:text-xs">
          <tr>
            <th class="ui:py-2 ui:pr-3 ui:font-medium">Họ và tên</th>
            <th class="ui:py-2 ui:pr-3 ui:font-medium">Lớp</th>
            <th class="ui:py-2 ui:pr-3 ui:font-medium">Số báo danh</th>
            <th class="ui:py-2 ui:pr-3 ui:font-medium">Trạng thái</th>
            <th class="ui:py-2 ui:pr-3 ui:font-medium">Điểm</th>
            <th class="ui:py-2 ui:pr-3 ui:font-medium">Thời gian làm</th>
            <th class="ui:py-2 ui:font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {#each shown as row (row.attemptId)}
            <tr class="ui:border-border ui:border-b">
              <td class="ui:py-2 ui:pr-3">
                <span class="ui:font-medium">{row.displayName ?? '—'}</span>
                <!--
                  Surfaced, never blocked. Two sitters may legitimately share a name, and
                  a person is better placed to judge than a rule is.
                -->
                {#if row.duplicateName}
                  <Badge variant="secondary" class="ui:ml-2">trùng tên</Badge>
                {/if}
                {#if row.duplicateAddress}
                  <Badge variant="secondary" class="ui:ml-1">cùng mạng</Badge>
                {/if}
              </td>
              <td class="ui:py-2 ui:pr-3">{row.className ?? '—'}</td>
              <td class="ui:py-2 ui:pr-3">{row.candidateNumber ?? '—'}</td>
              <td class="ui:py-2 ui:pr-3">{statusLabel(row)}</td>
              <td class="ui:py-2 ui:pr-3 ui:tabular-nums">{scoreLabel(row)}</td>
              <td class="ui:py-2 ui:pr-3 ui:tabular-nums">{minutesTaken(row)}</td>
              <td class="ui:py-2 ui:text-right">
                <Button size="sm" variant="ghost" onclick={() => onopen(row.attemptId)}>Xem bài</Button>
                {#if row.status !== 'in_progress'}
                  <Button size="sm" variant="ghost" onclick={() => onreopen(row.attemptId)}>Cho làm tiếp</Button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
