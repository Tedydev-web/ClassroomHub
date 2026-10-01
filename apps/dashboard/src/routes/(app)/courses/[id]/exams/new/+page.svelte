<script lang="ts">
  import { t } from '$lib/utils/functions/translations';
  import ExamSettingsForm from '$features/exam/exam-settings-form.svelte';
  import ExamImportButton from '$features/exam/exam-import-button.svelte';
  import { classroomhub } from '$lib/utils/services/api';
  import { snackbar } from '$features/ui/snackbar/store';
  import { Button } from '@cio/ui/base/button';
  import { Label } from '@cio/ui/base/label';
  import * as Page from '@cio/ui/base/page';
  import * as Select from '@cio/ui/base/select';
  import { RadioOptionCardGroup, type RadioOptionCardOption } from '@cio/ui/custom/radio-option-card';
  import { goto, invalidateAll } from '$app/navigation';
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
  import { Empty } from '@cio/ui/custom/empty';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { MOTION_DURATION, motionDuration } from '$lib/utils/motion';
  import { page } from '$app/state';

  /**
   * Creating an exam in two steps: where the questions come from, then the exam's settings.
   *
   * An exam delivers a detached copy of its questions, so nobody enrolled can open the paper
   * untimed. That copy used to be a step the teacher performed — "copy into a question set",
   * then pick the set, then configure — which put the storage model on screen. It now
   * happens on Create. A document goes through the importer, whose review screen publishes
   * the exam directly, so it never needs a course section or a course exercise at all.
   */
  let { data } = $props();

  type Source = 'exercise' | 'saved' | 'document';

  // Arriving from an exercise's "publish as exam" action preselects that exercise.
  const requestedExercise = page.url.searchParams.get('source');

  // Seeded once from what the course has: the radio group binds to it, and a teacher's pick
  // must survive the loader re-running.
  let selectedSource = $state<string>(
    requestedExercise || data.copyable.length > 0 ? 'exercise' : data.containers.length > 0 ? 'saved' : 'document'
  );
  const source = $derived(selectedSource as Source);

  let chosenExercise = $state<string | null>(requestedExercise);
  let chosenContainer = $state<string | null>(null);
  const exerciseId = $derived(chosenExercise ?? data.copyable[0]?.id ?? '');
  const containerId = $derived(chosenContainer ?? data.containers[0]?.id ?? '');

  let submitting = $state(false);

  const sourceOptions = $derived<RadioOptionCardOption[]>([
    {
      id: 'exercise',
      value: 'exercise',
      title: $t('exam.settings.source_exercise_title'),
      description:
        data.copyable.length > 0 ? $t('exam.settings.source_exercise_description') : $t('exam.settings.no_copyable'),
      disabled: data.copyable.length === 0
    },
    ...(data.containers.length > 0
      ? [
          {
            id: 'saved',
            value: 'saved',
            title: $t('exam.settings.source_saved_title'),
            description: $t('exam.settings.source_saved_description')
          }
        ]
      : []),
    {
      id: 'document',
      value: 'document',
      title: $t('exam.settings.source_document_title'),
      description: $t('exam.settings.source_document_description')
    }
  ]);

  /** Copies the chosen course exercise into a detached question set and returns its id. */
  async function copyExercise(): Promise<string | null> {
    const response = await classroomhub.exam.course[':courseId']['paper-from-exercise'].$post({
      param: { courseId: data.courseId },
      json: { exerciseId }
    });
    const body = await response.json();

    if ('success' in body && body.success) return body.data.id;

    snackbar.error('error' in body ? String(body.error) : $t('exam.settings.copy_failed'));
    return null;
  }

  async function create(settings: Record<string, unknown>) {
    submitting = true;

    try {
      const paperId = source === 'exercise' ? await copyExercise() : containerId;
      if (!paperId) {
        if (source !== 'exercise') snackbar.error($t('exam.settings.pick_container_first'));
        return;
      }

      const response = await classroomhub.exam.course[':courseId'].$post({
        param: { courseId: data.courseId },
        json: { ...settings, exerciseId: paperId }
      });
      const body = await response.json();

      if ('success' in body && body.success) {
        snackbar.success($t('exam.settings.created'));
        const examId = body.data?.id;
        await goto(examId ? `/courses/${data.courseId}/exams/${examId}` : `/courses/${data.courseId}/exams`);
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
      {#if data.loadFailed}
        <div in:fly={{ y: 4, duration: motionDuration(MOTION_DURATION.fast), easing: cubicOut }}>
          <Empty
            variant="page"
            icon={TriangleAlertIcon}
            title={$t('exam.settings.load_failed_title')}
            description={$t('exam.settings.load_failed_description')}
          >
            {#snippet children()}
              <Button onclick={() => invalidateAll()}>{$t('exam.settings.load_failed_retry')}</Button>
            {/snippet}
          </Empty>
        </div>
      {:else}
        <div class="space-y-8">
          <section class="space-y-3">
            <h2 class="text-base font-semibold">{$t('exam.settings.step_source')}</h2>
            <RadioOptionCardGroup
              options={sourceOptions}
              bind:value={selectedSource}
              class={sourceOptions.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'}
            />

            {#if source === 'exercise' && data.copyable.length > 0}
              <div class="space-y-2">
                <Label for="exam-source">{$t('exam.settings.source_exercise')}</Label>
                <Select.Root type="single" value={exerciseId} onValueChange={(value) => (chosenExercise = value)}>
                  <Select.Trigger id="exam-source" class="ui:w-full">
                    {data.copyable.find((exercise) => exercise.id === exerciseId)?.title ?? ''}
                  </Select.Trigger>
                  <Select.Content>
                    {#each data.copyable as exercise (exercise.id)}
                      <Select.Item value={exercise.id}>
                        {exercise.title} — {$t('exam.manage.question_count', {
                          count: String(exercise.questionCount)
                        })}
                      </Select.Item>
                    {/each}
                  </Select.Content>
                </Select.Root>
                <p class="ui:text-muted-foreground text-xs">{$t('exam.settings.copy_explainer')}</p>
              </div>
            {:else if source === 'saved'}
              <div class="space-y-2">
                <Label for="exam-container">{$t('exam.settings.pick_container')}</Label>
                <Select.Root type="single" value={containerId} onValueChange={(value) => (chosenContainer = value)}>
                  <Select.Trigger id="exam-container" class="ui:w-full">
                    {data.containers.find((container) => container.id === containerId)?.title ?? ''}
                  </Select.Trigger>
                  <Select.Content>
                    {#each data.containers as container (container.id)}
                      <Select.Item value={container.id}>{container.title}</Select.Item>
                    {/each}
                  </Select.Content>
                </Select.Root>
              </div>
            {:else if source === 'document'}
              <div class="ui:border-border space-y-3 rounded-md border p-4">
                <p class="ui:text-muted-foreground text-sm">{$t('exam.settings.document_hint')}</p>
                <ExamImportButton courseId={data.courseId} />
              </div>
            {/if}
          </section>

          {#if source !== 'document'}
            <section class="space-y-3">
              <h2 class="text-base font-semibold">{$t('exam.settings.step_settings')}</h2>
              <ExamSettingsForm {submitting} submitLabel={$t('exam.manage.create')} onsubmit={create} />
            </section>
          {/if}
        </div>
      {/if}
    {/snippet}
  </Page.Body>
</Page.Root>
