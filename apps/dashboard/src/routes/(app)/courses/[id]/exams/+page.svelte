<script lang="ts">
  import { t } from '$lib/utils/functions/translations';
  import { Button } from '@cio/ui/base/button';
  import * as Page from '@cio/ui/base/page';

  import ExamList from '$features/exam/exam-list.svelte';

  /**
   * The exams of one course, on their own page.
   *
   * Teachers reach exams through Submissions now; this route stays because links to it
   * were copied and bookmarked while it was a section of its own, and because the list
   * deserves a full page when somebody arrives with nothing else in mind.
   */
  let { data } = $props();
</script>

<Page.Root class="mx-auto flex w-[calc(95vw-var(--sidebar-width))]!">
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
