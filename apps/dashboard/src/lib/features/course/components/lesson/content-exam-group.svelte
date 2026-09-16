<script lang="ts">
  import { resolve } from '$app/paths';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import { ContentType } from '@cio/utils/constants/content';
  import CourseContentIcon from '$features/course/components/course-content-icon.svelte';
  import { courseExams } from '$features/course/api/exams.svelte';
  import { t } from '$lib/utils/functions/translations';

  /**
   * The course's exams, on the page that lists its content.
   *
   * The sidebar already shows this group; the content page did not, so the two disagreed
   * about what the course contains. This reads the same store rather than fetching again —
   * a second request would reintroduce exactly the disagreement the store's cache exists
   * to prevent.
   *
   * An exam is not course content: it delivers a detached container so an enrolled student
   * cannot open the paper from the course without a clock. So it is never shown to a
   * learner, and it never joins the reorder zone — the caller owns both gates.
   */
  let { courseId }: { courseId: string } = $props();

  const STATUS_LABEL: Record<string, string> = $derived({
    draft: $t('exam.manage.draft'),
    open: $t('exam.manage.open'),
    closed: $t('exam.manage.closed')
  });
</script>

<section class="mx-auto w-full p-3 lg:w-11/12">
  <div class="ui:border-border ui:dark:bg-card m-auto mb-3 max-w-xl rounded-md border transition">
    <div
      class="ui:bg-secondary flex min-h-[50px] items-center justify-between rounded-tl-md rounded-tr-md border-b px-3"
    >
      <div class="flex items-center gap-2">
        <CourseContentIcon type={ContentType.Exam} size={16} />
        <p class="text-sm">{$t('course.navItem.submissions.tab_exams')}</p>
      </div>

      <a
        href={resolve(`/courses/${courseId}/exams/new`, {})}
        class="ui:text-muted-foreground flex items-center gap-1 text-xs no-underline"
      >
        <PlusIcon size={14} />
        <span>{$t('exam.manage.create')}</span>
      </a>
    </div>

    <div class="m-3 flex flex-col gap-2">
      {#each courseExams.exams as exam (exam.id)}
        <a
          href={resolve(`/courses/${courseId}/exams/${exam.id}`, {})}
          title={exam.title}
          class="ui:border-border flex items-center gap-2 rounded-md border px-3 py-2 text-sm no-underline"
        >
          <CourseContentIcon type={ContentType.Exam} size={14} />
          <span class="flex-1 truncate">{exam.title}</span>
          <span
            class="ui:bg-muted ui:text-muted-foreground ui:text-2xs inline-flex items-center gap-1 rounded-full px-2 py-1"
          >
            {STATUS_LABEL[exam.status] ?? exam.status}
          </span>
        </a>
      {:else}
        <p class="ui:text-muted-foreground px-1 py-2 text-xs">{$t('exam.manage.empty')}</p>
      {/each}
    </div>
  </div>
</section>
