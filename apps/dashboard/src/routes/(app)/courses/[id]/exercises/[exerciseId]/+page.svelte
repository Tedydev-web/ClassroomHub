<script lang="ts">
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { Spinner } from '@cio/ui/base/spinner';
  import * as Page from '@cio/ui/base/page';
  import { ExercisePage } from '$features/course/pages';
  import { questionnaireMetaData, reset } from '$features/course/components/exercise/store';
  import { courseApi } from '$features/course/api';
  import { isOrgStudent } from '$lib/utils/store/app';
  import { hydrateExercisePageData } from '$features/course/utils/exercise-page-utils';
  import { restoreExerciseDraft } from '$features/course/utils/exercise-draft';
  import { getStudentContentLockReason } from '$features/ai-assistant/utils/content-ask-ai-bar';
  import { snackbar } from '$features/ui/snackbar/store';
  import { ContentType } from '@cio/utils/constants/content';
  import { invalidateAll } from '$app/navigation';
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
  import { Empty } from '@cio/ui/custom/empty';
  import { Button } from '@cio/ui/base/button';
  import { t } from '$lib/utils/functions/translations';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { MOTION_DURATION, motionDuration } from '$lib/utils/motion';

  let { data = $bindable() } = $props();

  const path = `/courses/${data.courseId}/lessons`;
  const isCourseReady = $derived(courseApi.course?.id === data.courseId);

  const contentLockReason = $derived(
    getStudentContentLockReason(courseApi.course, data.exerciseId, ContentType.Exercise)
  );

  const isLockedForStudent = $derived.by(() => {
    if (!$isOrgStudent) return false;

    if (data.exercise?.isUnlocked === false) {
      return true;
    }

    if (!data.exercise || contentLockReason !== null) {
      return true;
    }

    return false;
  });

  $effect(() => {
    if (!data.exercise || isLockedForStudent) return;

    const meta = get(questionnaireMetaData);
    if (meta.isFinished && meta.exerciseId === data.exerciseId) {
      return;
    }
    if (meta.exerciseId != null && meta.exerciseId !== data.exerciseId) {
      reset();
    }

    hydrateExercisePageData(data.exercise, data.exerciseId);

    // Puts back work stashed before an upgrade checkout redirect.
    if (restoreExerciseDraft(data.courseId, data.exerciseId)) {
      snackbar.success('snackbar.exercise.draft_restored');
    }
  });
</script>

<Page.Root class="mx-auto flex w-full px-3 sm:w-[90%] sm:px-4 lg:max-w-5xl">
  {#if data.loadFailed}
    <!-- Must come before everything else: the editor below renders from the store, so
         letting it mount on a failed load shows an empty exercise that a save would
         write over the real one. -->
    <div in:fly={{ y: 4, duration: motionDuration(MOTION_DURATION.fast), easing: cubicOut }}>
      <Empty
        variant="page"
        icon={TriangleAlertIcon}
        title={$t('course.navItem.lessons.exercises.load_failed_title')}
        description={$t('course.navItem.lessons.exercises.load_failed_description')}
      >
        {#snippet children()}
          <Button onclick={() => invalidateAll()}>
            {$t('course.navItem.lessons.exercises.load_failed_retry')}
          </Button>
        {/snippet}
      </Empty>
    </div>
  {:else if $isOrgStudent && !isCourseReady}
    <div class="flex justify-center py-16">
      <Spinner />
    </div>
  {:else}
    <ExercisePage
      exerciseId={data.exerciseId}
      goBack={() => goto(resolve(path, {}))}
      isFetching={false}
      submissions={data.submissions ?? []}
      mySubmissions={data.mySubmissions ?? []}
    />
  {/if}
</Page.Root>
