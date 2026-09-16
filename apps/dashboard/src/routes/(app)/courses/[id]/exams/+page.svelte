<script lang="ts">
  import { t } from '$lib/utils/functions/translations';
  import { Button } from '@cio/ui/base/button';
  import * as Page from '@cio/ui/base/page';

  import ExamList from '$features/exam/exam-list.svelte';
  import { RoleBasedSecurity } from '$features/ui';

  /**
   * The exams of one course, on their own page.
   *
   * Teachers reach exams through Submissions now; this route stays because links to it
   * were copied and bookmarked while it was a section of its own, and because the list
   * deserves a full page when somebody arrives with nothing else in mind.
   */
  let { data } = $props();
</script>

<!--
  Same guard as the Submissions route that renders this list in its Papers tab. Without it
  the two entry points to one list disagreed about who may open it: the API's course-team
  check kept a learner's data safe either way, but they arrived at a 404 rather than at an
  answer about permission.
-->
<RoleBasedSecurity allowedRoles={[1, 2]}>
  <Page.Root class="mx-auto flex w-full md:w-[calc(95vw-var(--sidebar-width))]!">
    <Page.Header>
      <Page.HeaderContent>
        <Page.Title>{$t('exam.manage.title')}</Page.Title>
      </Page.HeaderContent>
      <Page.Action>
        <Button href={`/courses/${data.courseId}/exams/new`}>{$t('exam.manage.create')}</Button>
      </Page.Action>
    </Page.Header>

    <Page.Body>
      {#snippet child()}
        <ExamList courseId={data.courseId} exams={data.exams} />
      {/snippet}
    </Page.Body>
  </Page.Root>
</RoleBasedSecurity>
