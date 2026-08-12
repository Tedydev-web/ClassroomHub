<script lang="ts">
  import { t } from '$lib/utils/functions/translations';
  import ExamSettingsForm from '$features/exam/exam-settings-form.svelte';
  import { classroomhub } from '$lib/utils/services/api';
  import { snackbar } from '$features/ui/snackbar/store';
  import { Button } from '@cio/ui/base/button';
  import { invalidateAll } from '$app/navigation';

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
  let source = $state<string | null>(null);
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

<div class="ui:mx-auto ui:w-full ui:max-w-3xl ui:space-y-6 ui:px-4 ui:py-6">
  <h1 class="ui:text-xl ui:font-semibold">{$t('exam.manage.create')}</h1>

  <div class="ui:border-border ui:space-y-3 ui:rounded-md ui:border ui:p-4">
    <div class="ui:space-y-1">
      <p class="ui:text-sm ui:font-medium">{$t('exam.settings.copy_from_exercise')}</p>
      <p class="ui:text-muted-foreground ui:text-xs">{$t('exam.settings.copy_explainer')}</p>
    </div>

    {#if data.copyable.length === 0}
      <p class="ui:text-muted-foreground ui:text-sm">{$t('exam.settings.no_copyable')}</p>
    {:else}
      <div class="ui:flex ui:flex-wrap ui:items-end ui:gap-3">
        <div class="ui:min-w-0 ui:flex-1 ui:space-y-2">
          <label class="ui:text-sm ui:font-medium" for="exam-source">{$t('exam.settings.source_exercise')}</label>
          <select
            id="exam-source"
            class="ui:border-border ui:w-full ui:rounded-md ui:border ui:px-3 ui:py-2 ui:text-sm"
            value={sourceId}
            onchange={(event: Event) => (source = (event.currentTarget as HTMLSelectElement).value)}
          >
            {#each data.copyable as exercise (exercise.id)}
              <option value={exercise.id}>
                {exercise.title} — {$t('exam.manage.question_count', { count: String(exercise.questionCount) })}
              </option>
            {/each}
          </select>
        </div>
        <Button disabled={copying} onclick={copyPaper}>
          {copying ? $t('exam.settings.copying') : $t('exam.settings.copy_paper')}
        </Button>
      </div>
    {/if}
  </div>

  {#if data.containers.length === 0}
    <p class="ui:text-muted-foreground ui:text-sm">
      {$t('exam.settings.no_containers')}
    </p>
  {:else}
    <div class="ui:space-y-2">
      <label class="ui:text-sm ui:font-medium" for="exam-container">{$t('exam.settings.pick_container')}</label>
      <select
        id="exam-container"
        class="ui:border-border ui:w-full ui:rounded-md ui:border ui:px-3 ui:py-2 ui:text-sm"
        value={exerciseId}
        onchange={(event: Event) => (chosen = (event.currentTarget as HTMLSelectElement).value)}
      >
        {#each data.containers as container (container.id)}
          <option value={container.id}>{container.title}</option>
        {/each}
      </select>
    </div>

    <ExamSettingsForm {submitting} onsubmit={create} />
  {/if}
</div>
