<script lang="ts">
  import { t } from '$lib/utils/functions/translations';
  import ExamSettingsForm from '$features/exam/exam-settings-form.svelte';
  import { classroomhub } from '$lib/utils/services/api';
  import { snackbar } from '$features/ui/snackbar/store';
  import { Button } from '@cio/ui/base/button';
  import { Label } from '@cio/ui/base/label';
  import * as Page from '@cio/ui/base/page';
  import * as Select from '@cio/ui/base/select';
  import { goto, invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';

  /**
   * Creating an exam from a paper held in a detached container. A teacher's questions start
   * life in a course exercise, so the first act here is usually copying one into a
   * container. The exam is then created in draft; opening it is a separate act, because
   * that is when its paper freezes.
   */
  let { data } = $props();

  let submitting = $state(false);
  let copying = $state(false);
  // Derived from the loader with a local override, for the same reason as everywhere else
  // in this feature: state seeded from `data` freezes at mount.
  let chosen = $state<string | null>(null);
  // Preselect the source when arriving from an exercise's "publish as exam" action.
  let source = $state<string | null>(page.url.searchParams.get('source'));
  const exerciseId = $derived(chosen ?? data.containers[0]?.id ?? '');
  const sourceId = $derived(source ?? data.copyable[0]?.id ?? '');

  async function copyPaper() {
    if (!sourceId) return;

    copying = true;

    try {
      const response = await classroomhub.exam.course[':courseId']['paper-from-exercise'].$post({
        param: { courseId: data.courseId },
        json: { exerciseId: sourceId }
      });
      const body = await response.json();

      if ('success' in body && body.success) {
        snackbar.success($t('exam.settings.paper_copied'));
        // Select the copy explicitly: the reload reorders the list, and a teacher who just
        // copied a paper means to build the exam from that one.
        chosen = body.data.id;
        await invalidateAll();
      } else {
        snackbar.error('error' in body ? String(body.error) : $t('exam.settings.copy_failed'));
      }
    } finally {
      copying = false;
    }
  }

  /** The question set may still be in a file. Take the teacher to the importer. */
  function goToImport() {
    goto(resolve(`/courses/${data.courseId}/content`, {}));
  }

  async function create(settings: Record<string, unknown>) {
    if (!exerciseId) {
      snackbar.error($t('exam.settings.pick_container_first'));
      return;
    }

    submitting = true;

    try {
      const response = await classroomhub.exam.course[':courseId'].$post({
        param: { courseId: data.courseId },
        json: { ...settings, exerciseId }
      });
      const body = await response.json();

      if ('success' in body && body.success) {
        snackbar.success($t('exam.settings.created'));
        window.location.href = `/courses/${data.courseId}/exams`;
      } else {
        snackbar.error('error' in body ? String(body.error) : $t('exam.settings.create_failed'));
      }
    } finally {
      submitting = false;
    }
  }
</script>

<Page.Root class="mx-auto flex w-full px-4 md:w-[90%] md:max-w-2xl lg:max-w-3xl">
  <Page.Header>
    <Page.HeaderContent>
      <Page.Title>{$t('exam.manage.create')}</Page.Title>
    </Page.HeaderContent>
  </Page.Header>

  <Page.Body>
    {#snippet child()}
      <div class="space-y-6">
        <div class="ui:border-border ui:space-y-3 ui:rounded-md ui:border ui:p-4">
          <div class="ui:space-y-1">
            <p class="ui:text-sm ui:font-medium">{$t('exam.settings.copy_from_exercise')}</p>
            <p class="ui:text-muted-foreground ui:text-xs">{$t('exam.settings.copy_explainer')}</p>
          </div>

          {#if data.copyable.length === 0}
            <p class="ui:text-muted-foreground ui:text-sm">{$t('exam.settings.no_copyable')}</p>
            <!-- Without this, a teacher whose questions are still in a file has to leave,
                 find the content screen, import there, and come back. -->
            <Button variant="secondary" onclick={goToImport}>{$t('exam.settings.import_document')}</Button>
          {:else}
            <div class="ui:flex ui:flex-wrap ui:items-end ui:gap-3">
              <div class="ui:min-w-0 ui:flex-1 ui:space-y-2">
                <Label for="exam-source">{$t('exam.settings.source_exercise')}</Label>
                <Select.Root type="single" value={sourceId} onValueChange={(value) => (source = value)}>
                  <Select.Trigger id="exam-source" class="ui:w-full">
                    {data.copyable.find((exercise) => exercise.id === sourceId)?.title ?? ''}
                  </Select.Trigger>
                  <Select.Content>
                    {#each data.copyable as exercise (exercise.id)}
                      <Select.Item value={exercise.id}>
                        {exercise.title} — {$t('exam.manage.question_count', { count: String(exercise.questionCount) })}
                      </Select.Item>
                    {/each}
                  </Select.Content>
                </Select.Root>
              </div>
              <Button disabled={copying} onclick={copyPaper}>
                {copying ? $t('exam.settings.copying') : $t('exam.settings.copy_paper')}
              </Button>
            </div>
            <Button variant="link" class="ui:h-auto ui:p-0 ui:text-xs" onclick={goToImport}>
              {$t('exam.settings.import_document')}
            </Button>
          {/if}
        </div>

        {#if data.containers.length === 0}
          <p class="ui:text-muted-foreground ui:text-sm">
            {$t('exam.settings.no_containers')}
          </p>
        {:else}
          <div class="ui:space-y-2">
            <Label for="exam-container">{$t('exam.settings.pick_container')}</Label>
            <Select.Root type="single" value={exerciseId} onValueChange={(value) => (chosen = value)}>
              <Select.Trigger id="exam-container" class="ui:w-full">
                {data.containers.find((container) => container.id === exerciseId)?.title ?? ''}
              </Select.Trigger>
              <Select.Content>
                {#each data.containers as container (container.id)}
                  <Select.Item value={container.id}>{container.title}</Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
          </div>

          <ExamSettingsForm {submitting} onsubmit={create} />
        {/if}
      </div>
    {/snippet}
  </Page.Body>
</Page.Root>
