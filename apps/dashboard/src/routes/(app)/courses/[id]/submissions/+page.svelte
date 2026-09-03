<script lang="ts">
  import { SubmissionsPage } from '$features/course/pages';
  import CourseExamAttempts from '$features/exam/course-exam-attempts.svelte';
  import { RefreshPageData, RoleBasedSecurity } from '$features/ui';
  import { Button } from '@cio/ui/base/button';
  import * as Page from '@cio/ui/base/page';
  import * as Tabs from '@cio/ui/base/tabs';
  import { t } from '$lib/utils/functions/translations';

  /**
   * Everything the learners handed in, exercises and exams together.
   *
   * Exams used to be a section of their own in the sidebar, which split "what did they
   * hand in" across two places a teacher had to remember. They are a tab here instead;
   * the route still exists for links that were already copied.
   *
   * The exam tab lists sittings, not papers: the tab beside it lists the exercises' own
   * submissions, and a paper is managed on its own page. Opening a row opens that
   * candidate's work.
   */
  let { data } = $props();

  let tab = $state<'exercises' | 'exams'>('exercises');
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
          {#if tab === 'exams'}
            <Button href={`/courses/${data.courseId}/exams/new`}>{$t('exam.manage.create')}</Button>
          {/if}
          <RefreshPageData />
        </div>
      </Page.Action>
    </Page.Header>

    <Page.Body>
      {#snippet child()}
        <Tabs.Root bind:value={tab} class="w-full">
          <Tabs.List class="inline-flex w-auto">
            <Tabs.Trigger value="exercises">{$t('course.navItem.submissions.tab_exercises')}</Tabs.Trigger>
            <Tabs.Trigger value="exams">{$t('course.navItem.submissions.tab_exams')}</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="exercises" class="mt-4">
            <SubmissionsPage
              courseId={data.courseId}
              sections={data.sections || []}
              submissionIdData={data.submissionIdData || {}}
            />
          </Tabs.Content>

          <Tabs.Content value="exams" class="mt-4">
            <CourseExamAttempts
              courseId={data.courseId}
              attempts={data.attempts ?? []}
              failed={data.attemptsFailed ?? false}
            />
          </Tabs.Content>
        </Tabs.Root>
      {/snippet}
    </Page.Body>
  </Page.Root>
</RoleBasedSecurity>
