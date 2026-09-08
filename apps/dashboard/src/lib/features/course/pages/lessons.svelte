<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { Empty } from '@cio/ui/custom/empty';
  import BookOpenIcon from '@lucide/svelte/icons/book-open';
  import ContentList from '$features/course/components/lesson/content-list.svelte';
  import ContentSectionList from '$features/course/components/lesson/content-section-list.svelte';
  import ContentExamGroup from '$features/course/components/lesson/content-exam-group.svelte';
  import CourseContentIcon from '$features/course/components/course-content-icon.svelte';
  import { courseApi } from '$features/course/api';
  import { t } from '$lib/utils/functions/translations';
  import { isCourseLearnerView, isOrgStudent } from '$lib/utils/store/app';
  import { courseExams } from '$features/course/api/exams.svelte';
  import { getCourseContent } from '$features/course/utils/content';
  import { getFirstIncompleteNavigableContent } from '$features/course/utils/content-navigation';
  import { ContentType } from '@cio/utils/constants/content';

  interface Props {
    courseId: string;
    reorder?: boolean;
  }

  let { courseId, reorder = $bindable(false) }: Props = $props();

  const query = new URLSearchParams(page.url.search);

  const contentData = $derived(getCourseContent(courseApi.course));
  const contentLength = $derived(contentData.grouped ? contentData.sections.length : contentData.items.length);
  const contentItems = $derived(
    contentData.grouped ? contentData.sections.flatMap((section) => section.items) : contentData.items
  );
  const navigableContentItems = $derived(
    contentItems.filter((item) => item.type === ContentType.Lesson || item.type === ContentType.Exercise)
  );

  const sectionsTotal = $derived(
    contentData.grouped ? contentData.sections.filter((section) => section.id !== 'ungrouped').length : 0
  );
  const lessonsTotal = $derived(contentItems.filter((item) => item.type === ContentType.Lesson).length);
  const exercisesTotal = $derived(contentItems.filter((item) => item.type === ContentType.Exercise).length);

  /**
   * Exams are listed here as well as in the sidebar, and only to someone who is not
   * reading the course as a learner — the sidebar's own rule, applied through the wider
   * store so a teacher previewing the learner view loses the group too. `available`
   * rather than a count: the feature sits behind a server flag, where "no exams" and
   * "no such feature" are different pages.
   */
  const canSeeExams = $derived(!$isCourseLearnerView && courseExams.available);

  $effect(() => {
    if ($isCourseLearnerView) return;
    void courseExams.load(courseId);
  });

  let isFetching: boolean = $state(false);
  let hasHandledNext = $state(false);

  const isCourseLoadedForThisPage = $derived(courseApi.course?.id === courseId);
  const canResolveNext = $derived(isCourseLoadedForThisPage && navigableContentItems.length > 0 && !hasHandledNext);

  $effect(() => {
    if (!canResolveNext || isFetching || query.get('next') !== 'true') return;

    hasHandledNext = true;
    const incompleteContent = getFirstIncompleteNavigableContent(courseApi.course);
    if (incompleteContent) {
      if (incompleteContent.type === ContentType.Lesson) {
        goto(`/courses/${courseId}/lessons/${incompleteContent.id}`);
      } else {
        goto(`/courses/${courseId}/exercises/${incompleteContent.id}`);
      }
    } else {
      goto(`/courses/${courseId}/lessons`);
    }
  });

  const shouldShowNextPlaceholder = $derived(query.get('next') === 'true');
</script>

{#if shouldShowNextPlaceholder}
  <Empty
    title={$t('course.navItem.lessons.no_lesson')}
    description={$isOrgStudent
      ? $t('course.navItem.lessons.student_share_your_knowledge')
      : $t('course.navItem.lessons.share_your_knowledge')}
    icon={BookOpenIcon}
    variant="page"
  />
{:else if contentLength > 0}
  <div
    class="mb-5 grid grid-cols-1 gap-3 {canSeeExams ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}"
    role="region"
    aria-label={t.get('course.navItem.lessons.heading_v2')}
  >
    <div class="ui:border-border flex flex-col gap-1 rounded-lg border px-4 py-3">
      <div class="ui:text-muted-foreground flex items-center gap-2 text-xs font-medium">
        <CourseContentIcon type={ContentType.Section} size={14} />
        <span>{$t('course.navItem.lessons.stats.sections')}</span>
      </div>
      <p class="text-2xl font-semibold tabular-nums">{sectionsTotal}</p>
    </div>
    <div class="ui:border-border flex flex-col gap-1 rounded-lg border px-4 py-3">
      <div class="ui:text-muted-foreground flex items-center gap-2 text-xs font-medium">
        <CourseContentIcon type={ContentType.Lesson} size={14} />
        <span>{$t('course.navItem.lessons.stats.lessons')}</span>
      </div>
      <p class="text-2xl font-semibold tabular-nums">{lessonsTotal}</p>
    </div>
    <div class="ui:border-border flex flex-col gap-1 rounded-lg border px-4 py-3">
      <div class="ui:text-muted-foreground flex items-center gap-2 text-xs font-medium">
        <CourseContentIcon type={ContentType.Exercise} size={14} />
        <span>{$t('course.navItem.lessons.stats.exercises')}</span>
      </div>
      <p class="text-2xl font-semibold tabular-nums">{exercisesTotal}</p>
    </div>
    {#if canSeeExams}
      <div class="ui:border-border flex flex-col gap-1 rounded-lg border px-4 py-3">
        <div class="ui:text-muted-foreground flex items-center gap-2 text-xs font-medium">
          <CourseContentIcon type={ContentType.Exam} size={14} />
          <span>{$t('course.navItem.submissions.tab_exams')}</span>
        </div>
        <p class="text-2xl font-semibold tabular-nums">{courseExams.exams.length}</p>
      </div>
    {/if}
  </div>

  {#if reorder}
    <p class="text-center text-xs text-gray-400 italic dark:text-white">
      {$t('course.navItem.lessons.drag')}
    </p>
  {/if}

  {#if contentData.grouped}
    <ContentSectionList {reorder} />
  {:else}
    <ContentList {reorder} />
  {/if}

  {#if canSeeExams && !reorder}
    <ContentExamGroup {courseId} />
  {/if}
{:else}
  <Empty
    title={$t('course.navItem.lessons.body_header')}
    description={$isOrgStudent
      ? $t('course.navItem.lessons.student_body_content')
      : $t('course.navItem.lessons.body_content')}
    icon={BookOpenIcon}
    variant="page"
  />

  {#if canSeeExams}
    <ContentExamGroup {courseId} />
  {/if}
{/if}
