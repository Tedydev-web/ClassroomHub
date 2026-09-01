<script lang="ts">
  import { locale, t } from '$lib/utils/functions/translations';
  import { Badge } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import { Input } from '@cio/ui/base/input';
  import * as Table from '@cio/ui/base/table';
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
    gradingState: 'complete' | 'awaiting_manual' | 'unscoreable';
    score: string | null;
    total: string | null;
    startedAt: string;
    submittedAt: string | null;
  };

  let { courseId, attempts }: { courseId: string; attempts: CourseAttemptRow[] } = $props();

  let search = $state('');
  let examId = $state<'all' | string>('all');

  /** The papers that actually have a sitting, in the order the rows arrive (newest first). */
  const exams = $derived(
    attempts
      .map((row) => ({ id: row.examId, title: row.examTitle }))
      .filter((exam, index, all) => all.findIndex((other) => other.id === exam.id) === index)
  );

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

  function statusLabel(row: CourseAttemptRow): string {
    if (row.gradingState === 'unscoreable') return $t('exam.status.unscoreable');
    if (row.gradingState === 'awaiting_manual') return $t('exam.status.awaiting_manual');
    if (row.status === 'in_progress') return $t('exam.status.in_progress');
    if (row.status === 'expired') return $t('exam.status.expired');

    return $t('exam.status.submitted');
  }

  function statusVariant(row: CourseAttemptRow): 'default' | 'secondary' | 'outline' | 'destructive' {
    if (row.gradingState === 'unscoreable') return 'destructive';
    if (row.gradingState === 'awaiting_manual') return 'default';
    if (row.status === 'in_progress') return 'outline';

    return 'secondary';
  }

  function scoreLabel(row: CourseAttemptRow): string {
    if (row.score === null || row.total === null) return '—';

    const suffix = row.gradingState === 'awaiting_manual' ? ` (${$t('exam.results.partial_score')})` : '';

    return `${row.score}/${row.total}${suffix}`;
  }

  /** When they handed it in, or when they started if they have not. */
  function whenLabel(row: CourseAttemptRow): string {
    const moment = row.submittedAt ?? row.startedAt;

    return new Date(moment).toLocaleString($locale, {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
</script>

<div class="space-y-4">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <Input class="w-56" placeholder={$t('exam.results.search_placeholder')} bind:value={search} />

      <Button size="sm" variant={examId === 'all' ? 'default' : 'outline'} onclick={() => (examId = 'all')}>
        {$t('exam.results.all_exams')}
      </Button>
      {#each exams as exam (exam.id)}
        <Button size="sm" variant={examId === exam.id ? 'default' : 'outline'} onclick={() => (examId = exam.id)}>
          {exam.title}
        </Button>
      {/each}
    </div>

    <Button variant="outline" size="sm" href={`/courses/${courseId}/exams`}>
      {$t('exam.results.manage_exams')}
    </Button>
  </div>

  {#if shown.length === 0}
    <Empty.Root>
      <Empty.Content>
        <Empty.Description>{$t('exam.results.course_empty')}</Empty.Description>
      </Empty.Content>
    </Empty.Root>
  {:else}
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>{$t('exam.entry.full_name')}</Table.Head>
          <Table.Head>{$t('exam.results.exam_column')}</Table.Head>
          <Table.Head>{$t('exam.entry.class_name')}</Table.Head>
          <Table.Head>{$t('exam.results.status_column')}</Table.Head>
          <Table.Head>{$t('exam.results.score_column')}</Table.Head>
          <Table.Head>{$t('exam.results.submitted_at_column')}</Table.Head>
          <Table.Head></Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each shown as row (row.attemptId)}
          <Table.Row>
            <Table.Cell class="font-medium">
              {row.displayName ?? '—'}
              {#if row.nickname}
                <span class="text-muted-foreground text-xs">({row.nickname})</span>
              {/if}
            </Table.Cell>
            <Table.Cell>
              <a class="hover:underline" href={`/courses/${courseId}/exams/${row.examId}/results`}>{row.examTitle}</a>
            </Table.Cell>
            <Table.Cell>{row.className ?? '—'}</Table.Cell>
            <Table.Cell><Badge variant={statusVariant(row)}>{statusLabel(row)}</Badge></Table.Cell>
            <Table.Cell class="tabular-nums">{scoreLabel(row)}</Table.Cell>
            <Table.Cell class="tabular-nums">{whenLabel(row)}</Table.Cell>
            <Table.Cell class="text-right">
              <Button
                variant="ghost"
                size="sm"
                href={`/courses/${courseId}/exams/${row.examId}/attempts/${row.attemptId}`}
              >
                {$t('exam.results.open_attempt')}
              </Button>
            </Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  {/if}
</div>
