<script lang="ts">
  import { locale, t } from '$lib/utils/functions/translations';
  import { Badge } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import * as Table from '@cio/ui/base/table';
  import * as Empty from '@cio/ui/base/empty';
  import * as DropdownMenu from '@cio/ui/base/dropdown-menu';
  import { IconButton } from '@cio/ui/custom/icon-button';
  import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import { snackbar } from '$features/ui/snackbar/store';

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
    nickname?: string | null;
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
    onreopen,
    ondelete
  }: {
    rows: ExamResultRow[];
    onopen: (attemptId: string) => void;
    onreopen: (attemptId: string) => void;
    ondelete: (attemptId: string, displayName: string | null) => void;
  } = $props();

  type Filter = 'all' | 'in_progress' | 'expired' | 'submitted' | 'awaiting_manual';
  let filter = $state<Filter>('all');

  type SortKey = 'name' | 'score' | 'time';
  let sortKey = $state<SortKey>('name');
  let sortDescending = $state(false);

  /** Minutes between starting and submitting, or null while a sitting is still open. */
  function minutesOf(row: ExamResultRow): number | null {
    if (!row.submittedAt) return null;

    return Math.max(0, Math.round((new Date(row.submittedAt).getTime() - new Date(row.startedAt).getTime()) / 60_000));
  }

  /**
   * What the class did, above the rows.
   *
   * A teacher opening results wants two numbers before any individual one: how much of
   * the class is in, and how much of it is still waiting on them. Both were absent, so the
   * only way to learn either was to count the table by eye.
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
      // Only when every scored sitting was marked out of the same number. Re-opening an
      // exam re-freezes its paper, so a class can hold attempts scored out of different
      // totals; taking the first row's would print an average over one denominator beside
      // a different one.
      outOf: new Set(scored.map((row) => row.total)).size === 1 ? (scored[0]?.total ?? null) : null
    };
  });

  const FILTERS: Array<{ value: Filter; label: string }> = [
    { value: 'all', label: $t('exam.status.all') },
    { value: 'in_progress', label: $t('exam.status.in_progress') },
    { value: 'expired', label: $t('exam.status.expired') },
    { value: 'submitted', label: $t('exam.status.submitted') },
    { value: 'awaiting_manual', label: $t('exam.status.awaiting_manual') }
  ];

  const shown = $derived.by(() => {
    const filtered = rows.filter((row) => {
      if (filter === 'all') return true;
      if (filter === 'awaiting_manual') return row.gradingState === 'awaiting_manual';

      return row.status === filter;
    });

    // Sorted by whichever column the teacher asked for. A sitting with no score or no
    // finish time sorts last in either direction rather than jumping to the top of a
    // descending sort, because "not yet" is not a high value.
    //
    // The missing cases are branches rather than arithmetic on infinity: two missing values
    // subtracted give NaN, and a comparator that returns NaN has no defined behaviour — it
    // breaks the sort's transitivity and the order it produces stops being meaningful.
    const direction = sortDescending ? -1 : 1;
    const compareNumbers = (left: number | null, right: number | null) => {
      if (left === null && right === null) return 0;
      if (left === null) return 1;
      if (right === null) return -1;

      return (left - right) * direction;
    };

    return [...filtered].sort((left, right) => {
      if (sortKey === 'score') {
        return compareNumbers(
          left.score === null ? null : Number(left.score),
          right.score === null ? null : Number(right.score)
        );
      }
      if (sortKey === 'time') return compareNumbers(minutesOf(left), minutesOf(right));

      // Compared in the reader's language, and unnamed sittings go last like every other
      // missing value. `undefined` here meant the order followed whichever locale the
      // browser happened to be in, which for Vietnamese names is a different order.
      const leftName = left.displayName ?? '';
      const rightName = right.displayName ?? '';
      if (leftName === '' && rightName === '') return 0;
      if (leftName === '') return 1;
      if (rightName === '') return -1;

      return leftName.localeCompare(rightName, $locale, { numeric: true }) * direction;
    });
  });

  function sortBy(key: SortKey) {
    if (sortKey === key) {
      sortDescending = !sortDescending;

      return;
    }

    sortKey = key;
    sortDescending = false;
  }

  /**
   * The marks as a file, because the alternative is retyping them.
   *
   * Built here rather than fetched: the rows on screen are already the rows a teacher
   * means, filter and all, and a second server round trip could disagree with what they
   * are looking at.
   */
  function exportCsv() {
    const header = [
      $t('exam.entry.full_name'),
      $t('exam.entry.nickname'),
      $t('exam.entry.class_name'),
      $t('exam.entry.candidate_number'),
      $t('exam.results.status_column'),
      $t('exam.results.score_column'),
      $t('exam.results.time_taken_column')
    ];
    /**
     * Quoted, and defused.
     *
     * A cell a spreadsheet reads as a formula is a cell it will execute when the teacher
     * opens the file, and every name here was typed by whoever sat the exam. Prefixing the
     * four leading characters that start a formula with an apostrophe makes the cell text
     * again; the apostrophe is not displayed.
     */
    const escape = (value: string) => {
      const defused = /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;

      return `"${defused.replace(/"/gu, '""')}"`;
    };
    const lines = [
      header.map(escape).join(','),
      ...shown.map((row) =>
        [
          row.displayName ?? '',
          row.nickname ?? '',
          row.className ?? '',
          row.candidateNumber ?? '',
          statusLabel(row),
          row.score === null ? '' : `${row.score}/${row.total ?? ''}`,
          minutesOf(row) === null ? '' : String(minutesOf(row))
        ]
          .map(escape)
          .join(',')
      )
    ];

    // A BOM, so the file opens with its diacritics intact in the spreadsheet most of these
    // teachers actually use.
    const blob = new Blob([`\ufeff${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    // Attached before the click and revoked on the next tick: Safari has historically
    // ignored a click on a detached anchor, and revoking in the same tick races the download
    // the click just started.
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${$t('exam.manage.results').toLowerCase()}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url));
    snackbar.success($t('exam.results.exported'));
  }

  /** Only the two states that ask something of a teacher take a colour. */
  function statusVariant(row: ExamResultRow): 'default' | 'secondary' | 'outline' | 'destructive' {
    if (row.gradingState === 'unscoreable') return 'destructive';
    if (row.gradingState === 'awaiting_manual') return 'default';
    if (row.status === 'in_progress') return 'outline';

    return 'secondary';
  }

  function statusLabel(row: ExamResultRow): string {
    if (row.gradingState === 'unscoreable') return $t('exam.status.unscoreable');
    if (row.gradingState === 'awaiting_manual') return $t('exam.status.awaiting_manual');
    if (row.status === 'in_progress') return $t('exam.status.in_progress');
    if (row.status === 'expired') return $t('exam.status.expired');
    return $t('exam.status.submitted');
  }

  function scoreLabel(row: ExamResultRow): string {
    if (row.score === null || row.total === null) return '—';

    const suffix = row.gradingState === 'awaiting_manual' ? ` (${$t('exam.results.partial_score')})` : '';
    return `${row.score}/${row.total}${suffix}`;
  }

  function minutesTaken(row: ExamResultRow): string {
    if (!row.submittedAt) return '—';

    const minutes = Math.max(
      0,
      Math.round((new Date(row.submittedAt).getTime() - new Date(row.startedAt).getTime()) / 60_000)
    );
    return $t('exam.results.minutes_taken', { minutes: String(minutes) });
  }
</script>

<div class="ui:space-y-4">
  <!--
    What the class did, before any individual did it. Four numbers, and the only one that
    can require action is the one that takes a colour.
  -->
  <div class="ui:grid ui:gap-3 ui:grid-cols-2 ui:lg:grid-cols-4">
    {#snippet stat(label: string, value: string, accent = false)}
      <div class="ui:border-border ui:rounded-lg ui:border ui:px-3 ui:py-2">
        <p class="ui:text-muted-foreground ui:text-xs">{label}</p>
        <p
          class={accent
            ? 'ui:text-lg ui:font-semibold ui:tabular-nums ui:text-amber-600 ui:dark:text-amber-400'
            : 'ui:text-lg ui:font-semibold ui:tabular-nums'}
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

  <div class="ui:flex ui:flex-wrap ui:items-center ui:justify-between ui:gap-3">
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

    {#if shown.length > 0}
      <Button size="sm" variant="outline" onclick={exportCsv}>
        <DownloadIcon size={14} />
        {$t('exam.results.export_csv')}
      </Button>
    {/if}
  </div>

  {#if shown.length === 0}
    <Empty.Root class="ui:border-border ui:rounded-lg ui:border ui:border-dashed">
      <Empty.Header>
        <Empty.Title>{filter === 'all' ? $t('exam.results.empty') : $t('exam.results.empty_filter')}</Empty.Title>
      </Empty.Header>
    </Empty.Root>
  {:else}
    <div class="ui:overflow-x-auto">
      <Table.Root class="ui:text-sm min-w-3xl">
        <Table.Header>
          <Table.Row>
            <!--
              Sortable where sorting answers a question a teacher actually asks: who is at
              the bottom, who took longest, and where is a name in a class list.
            -->
            <Table.Head aria-sort={sortKey === 'name' ? (sortDescending ? 'descending' : 'ascending') : 'none'}>
              <button type="button" class="ui:font-medium ui:hover:underline" onclick={() => sortBy('name')}>
                {$t('exam.entry.full_name')}<span aria-hidden="true"
                  >{sortKey === 'name' ? (sortDescending ? ' ↓' : ' ↑') : ''}</span
                >
              </button>
            </Table.Head>
            <Table.Head>{$t('exam.entry.class_name')}</Table.Head>
            <Table.Head>{$t('exam.entry.candidate_number')}</Table.Head>
            <Table.Head>{$t('exam.results.status_column')}</Table.Head>
            <Table.Head
              class="ui:text-right"
              aria-sort={sortKey === 'score' ? (sortDescending ? 'descending' : 'ascending') : 'none'}
            >
              <button type="button" class="ui:font-medium ui:hover:underline" onclick={() => sortBy('score')}>
                {$t('exam.results.score_column')}<span aria-hidden="true"
                  >{sortKey === 'score' ? (sortDescending ? ' ↓' : ' ↑') : ''}</span
                >
              </button>
            </Table.Head>
            <Table.Head
              class="ui:text-right"
              aria-sort={sortKey === 'time' ? (sortDescending ? 'descending' : 'ascending') : 'none'}
            >
              <button type="button" class="ui:font-medium ui:hover:underline" onclick={() => sortBy('time')}>
                {$t('exam.results.time_taken_column')}<span aria-hidden="true"
                  >{sortKey === 'time' ? (sortDescending ? ' ↓' : ' ↑') : ''}</span
                >
              </button>
            </Table.Head>
            <Table.Head class="ui:w-0"></Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each shown as row (row.attemptId)}
            <Table.Row>
              <Table.Cell class="ui:font-medium">
                <span class="ui:align-middle">{row.displayName ?? '—'}</span>
                {#if row.nickname}
                  <!-- Beside the name rather than instead of it: it exists to separate two
                       identical names, so both have to be readable at once. -->
                  <span class="ui:text-muted-foreground ui:align-middle ui:text-xs">({row.nickname})</span>
                {/if}
                <!--
                  Surfaced, never blocked. Two sitters may legitimately share a name, and
                  a person is better placed to judge than a rule is.
                -->
                {#if row.duplicateName}
                  <Badge variant="secondary" class="ui:ml-2">{$t('exam.results.duplicate_name')}</Badge>
                {/if}
                {#if row.duplicateAddress}
                  <Badge variant="secondary" class="ui:ml-1">{$t('exam.results.duplicate_address')}</Badge>
                {/if}
              </Table.Cell>
              <Table.Cell class="ui:text-muted-foreground">{row.className ?? '—'}</Table.Cell>
              <Table.Cell class="ui:text-muted-foreground ui:tabular-nums">{row.candidateNumber ?? '—'}</Table.Cell>
              <Table.Cell>
                <Badge variant={statusVariant(row)}>{statusLabel(row)}</Badge>
              </Table.Cell>
              <!-- Numbers right-aligned with tabular figures, so columns of marks line up. -->
              <Table.Cell class="ui:text-right ui:font-medium ui:tabular-nums">{scoreLabel(row)}</Table.Cell>
              <Table.Cell class="ui:text-muted-foreground ui:text-right ui:tabular-nums">{minutesTaken(row)}</Table.Cell
              >
              <Table.Cell class="ui:text-right">
                <div class="ui:flex ui:items-center ui:justify-end ui:gap-1">
                  <Button size="sm" variant="ghost" onclick={() => onopen(row.attemptId)}>
                    {$t('exam.results.open_attempt')}
                  </Button>
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger class="ui:inline-flex ui:items-center ui:justify-center">
                      <IconButton aria-label={$t('exam.results.row_actions')}>
                        <EllipsisVerticalIcon size={16} />
                      </IconButton>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content align="end">
                      {#if row.status !== 'in_progress'}
                        <DropdownMenu.Item onclick={() => onreopen(row.attemptId)}>
                          {$t('exam.results.reopen')}
                        </DropdownMenu.Item>
                      {/if}
                      <!-- Destructive stays last and coloured; a delete here loses the sitting. -->
                      <DropdownMenu.Item
                        class="ui:text-destructive"
                        onclick={() => ondelete(row.attemptId, row.displayName)}
                      >
                        {$t('exam.results.delete')}
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                </div>
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </div>
  {/if}
</div>
