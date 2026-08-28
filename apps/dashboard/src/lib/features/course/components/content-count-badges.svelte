<script lang="ts">
  import * as Tooltip from '@cio/ui/base/tooltip';
  import { ContentType } from '@cio/utils/constants/content';
  import CourseContentIcon from '$features/course/components/course-content-icon.svelte';
  import { t } from '$lib/utils/functions/translations';

  interface Props {
    lessons: number;
    exercises: number;
    /** Absent for a student, and absent where the exam feature is switched off. */
    exams?: number | null;
  }

  let { lessons, exercises, exams = null }: Props = $props();
</script>

<Tooltip.Provider>
  <Tooltip.Root>
    <Tooltip.Trigger>
      <span class="inline-flex items-center gap-1 rounded border px-1 py-0.5 text-[10px] leading-none">
        <CourseContentIcon type={ContentType.Lesson} size={12} />
        <span>{lessons}</span>
      </span>
    </Tooltip.Trigger>
    <Tooltip.Content side="top" sideOffset={4}>
      {$t('course.sidebar.content_count.lessons', { count: lessons })}
    </Tooltip.Content>
  </Tooltip.Root>

  <Tooltip.Root>
    <Tooltip.Trigger>
      <span class="inline-flex items-center gap-1 rounded border px-1 py-0.5 text-[10px] leading-none">
        <CourseContentIcon type={ContentType.Exercise} size={12} />
        <span>{exercises}</span>
      </span>
    </Tooltip.Trigger>
    <Tooltip.Content side="top" sideOffset={4}>
      {$t('course.sidebar.content_count.exercises', { count: exercises })}
    </Tooltip.Content>
  </Tooltip.Root>

  {#if exams !== null}
    <Tooltip.Root>
      <Tooltip.Trigger>
        <span class="inline-flex items-center gap-1 rounded border px-1 py-0.5 text-[10px] leading-none">
          <CourseContentIcon type={ContentType.Exam} size={12} />
          <span>{exams}</span>
        </span>
      </Tooltip.Trigger>
      <Tooltip.Content side="top" sideOffset={4}>
        {$t('course.sidebar.content_count.exams', { count: exams })}
      </Tooltip.Content>
    </Tooltip.Root>
  {/if}
</Tooltip.Provider>
