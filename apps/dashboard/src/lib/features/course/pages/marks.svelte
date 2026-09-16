<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { MOTION_DURATION, motionDuration } from '$lib/utils/motion';
  import { Empty } from '@cio/ui/custom/empty';
  import { Button } from '@cio/ui/base/button';
  import UserXIcon from '@lucide/svelte/icons/user-x';
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
  import { UserAvatar } from '@cio/ui/custom/user-avatar';
  import * as Table from '@cio/ui/base/table';
  import * as Tooltip from '@cio/ui/base/tooltip';
  import { t } from '$lib/utils/functions/translations';
  import { calculateStudentAverage, gradePercent, type MarksPageData } from '$features/course/utils/marks-utils';
  import TruncatedWithTooltip from '$features/course/components/truncated-with-tooltip.svelte';

  interface Props {
    marksData: MarksPageData | null;
    /**
     * The gradebook request failed, which is not the same as a course with no students.
     * Without this the page renders the empty state and tells the teacher something untrue.
     */
    loadFailed?: boolean;
  }

  let { marksData, loadFailed = false }: Props = $props();

  async function retry() {
    try {
      await invalidateAll();
    } catch (error) {
      console.error('marks retry error:', error);
    }
  }

  const students = $derived(marksData?.students ?? []);
  const exercises = $derived(marksData?.exercises ?? []);
  const studentMarksByExerciseId = $derived(marksData?.studentMarksByExerciseId ?? {});

  /** Text and background classes for grade cells (faint tint + matching text) */
  function gradeCellClass(percent: number | null): string {
    if (percent == null) return 'bg-transparent ui:text-muted-foreground';
    if (percent >= 90) return 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400';
    if (percent >= 80) return 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400';
    if (percent >= 70) return 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-400';
    return 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400';
  }
</script>

{#if loadFailed}
  <!-- Deliberately the fast token rather than base: the teacher is already waiting on a
       request that failed, and an error has no business sauntering in. -->
  <div in:fly={{ y: 4, duration: motionDuration(MOTION_DURATION.fast), easing: cubicOut }}>
    <Empty
      variant="page"
      icon={TriangleAlertIcon}
      title={$t('course.navItem.marks.load_failed_title')}
      description={$t('course.navItem.marks.load_failed_description')}
    >
      {#snippet children()}
        <Button onclick={retry}>{$t('course.navItem.marks.retry')}</Button>
      {/snippet}
    </Empty>
  </div>
{:else if students.length > 0}
  <div class="ui:border-border rounded-md border">
    <Tooltip.Provider>
      <Table.Root class="">
        <Table.Header>
          <Table.Row class="ui:border-border border-b-2">
            <Table.Head
              class="ui:text-foreground ui:border-border ui:bg-muted sticky left-0 z-100! min-w-[200px] border-r px-3 py-3 text-left text-sm font-semibold"
            >
              {$t('course.navItem.marks.student')}
            </Table.Head>
            {#each exercises as exercise (exercise.id)}
              <Table.Head
                class="ui:border-border ui:bg-background min-w-[100px] border-r px-2 py-3 text-center text-sm font-semibold last:border-r-0"
              >
                <TruncatedWithTooltip text={exercise.title} maxWidth="100px" />
              </Table.Head>
            {/each}
            <Table.Head
              class="ui:border-border ui:bg-background min-w-[90px] px-2 py-3 text-center text-sm font-semibold"
            >
              {$t('course.navItem.marks.avg_grade')}
            </Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each students as student (student.id)}
            {@const marks = studentMarksByExerciseId[student.id]}
            {@const avg = calculateStudentAverage(marks, exercises)}
            <Table.Row class="ui:border-border border-b">
              <Table.Cell class="ui:border-border ui:bg-muted sticky left-0 min-w-[200px] border-r px-3 py-2">
                <div class="flex items-center gap-2">
                  <UserAvatar
                    src={student.profile?.avatarUrl}
                    alt={student.profile?.fullname ?? 'Student'}
                    class="size-6! shrink-0"
                  />
                  <div class="min-w-0 flex-1">
                    <p class="ui:text-foreground truncate text-sm font-medium">
                      {student.profile?.fullname ?? '-'}
                    </p>
                  </div>
                </div>
              </Table.Cell>
              {#each exercises as exercise (exercise.id)}
                {@const mark = marks?.[exercise.id]}
                {@const pct = gradePercent(mark)}
                <Table.Cell
                  class="ui:border-border min-w-[100px] border-r px-2 py-2 text-center text-sm {gradeCellClass(pct)}"
                >
                  <span class="font-medium">
                    {pct != null ? pct : (mark?.score ?? '-')}
                  </span>
                </Table.Cell>
              {/each}
              <Table.Cell class="min-w-[90px] px-2 py-2 text-center text-sm {gradeCellClass(avg ?? null)}">
                <span class="font-medium">
                  {avg != null ? avg : '-'}
                </span>
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </Tooltip.Provider>
  </div>
{:else}
  <Empty title={$t('course.navItem.marks.no_student')} icon={UserXIcon} variant="page" />
{/if}
