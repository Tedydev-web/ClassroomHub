<script lang="ts">
  import { SubmissionsPage } from '$features/course/pages';
  import CourseExamAttempts from '$features/exam/course-exam-attempts.svelte';
  import ExamList from '$features/exam/exam-list.svelte';
  import { RefreshPageData, RoleBasedSecurity } from '$features/ui';
  import { Button } from '@cio/ui/base/button';
  import * as Page from '@cio/ui/base/page';
  import * as UnderlineTabs from '@cio/ui/custom/underline-tabs';
  import { t } from '$lib/utils/functions/translations';

  /**
   * Everything the learners handed in, and the papers they sat.
   *
   * Exams used to be a section of their own in the sidebar, which split "what did they
   * hand in" across two places a teacher had to remember. They are tabs here instead;
   * the route still exists for links that were already copied.
   *
   * Three tabs, in the order a teacher opens them. Sittings first, because a course that
   * runs exams is opened to read them; then the exercises' own submissions; then the
   * papers themselves. That last one was a button leading off the page, so closing a
   * paper a teacher had just been reading the results of meant leaving and coming back.
   */
  let { data } = $props();

  let tab = $state<'exams' | 'exercises' | 'papers'>('exams');
</script>

<RoleBasedSecurity allowedRoles={[1, 2]}>
  <Page.Root class="mx-auto flex w-full md:w-[calc(95vw-var(--sidebar-width))]!">
    <Page.Header>
      <Page.HeaderContent>
        <Page.Title>
          {$t('course.navItem.submissions.title')}
        </Page.Title>
      </Page.HeaderContent>
      <Page.Action>
        <div class="flex items-center gap-2">
          {#if tab !== 'exercises'}
            <Button href={`/courses/${data.courseId}/exams/new`}>{$t('exam.manage.create')}</Button>
          {/if}
          <RefreshPageData />
        </div>
      </Page.Action>
    </Page.Header>

    <Page.Body>
      {#snippet child()}
        <!--
          The same tab strip the rest of the app uses. This screen had the boxed two-column
          one, which stretched across the page and read as a segmented control rather than
          as tabs, so the one page a teacher moves between exams and exercises on was the
          one page whose tabs looked like something else.
        -->
        <UnderlineTabs.Root bind:value={tab} class="w-full">
          <UnderlineTabs.List>
            <UnderlineTabs.Trigger value="exams">
              {$t('course.navItem.submissions.tab_exams')}
            </UnderlineTabs.Trigger>
            <UnderlineTabs.Trigger value="exercises">
              {$t('course.navItem.submissions.tab_exercises')}
            </UnderlineTabs.Trigger>
            <UnderlineTabs.Trigger value="papers">
              {$t('course.navItem.submissions.tab_papers')}
            </UnderlineTabs.Trigger>
          </UnderlineTabs.List>

          <UnderlineTabs.Content value="exams" class="mt-4">
            <CourseExamAttempts
              courseId={data.courseId}
              attempts={data.attempts ?? []}
              failed={data.attemptsFailed ?? false}
            />
          </UnderlineTabs.Content>

          <UnderlineTabs.Content value="exercises" class="mt-4">
            <SubmissionsPage
              courseId={data.courseId}
              sections={data.sections || []}
              submissionIdData={data.submissionIdData || {}}
              failed={data.submissionsFailed ?? false}
            />
          </UnderlineTabs.Content>

          <UnderlineTabs.Content value="papers" class="mt-4">
            <ExamList courseId={data.courseId} exams={data.exams ?? []} failed={data.examsFailed ?? false} />
          </UnderlineTabs.Content>
        </UnderlineTabs.Root>
      {/snippet}
    </Page.Body>
  </Page.Root>
</RoleBasedSecurity>
