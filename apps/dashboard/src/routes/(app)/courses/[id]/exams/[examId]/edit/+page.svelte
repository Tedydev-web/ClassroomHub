<script lang="ts">
  import { t } from '$lib/utils/functions/translations';
  import ExamSettingsForm from '$features/exam/exam-settings-form.svelte';
  import ExamTabs from '$features/exam/exam-tabs.svelte';
  import { classroomhub } from '$lib/utils/services/api';
  import { snackbar } from '$features/ui/snackbar/store';
  import * as Alert from '@cio/ui/base/alert';
  import * as Page from '@cio/ui/base/page';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';

  /**
   * Changing an exam that already exists. Until this screen the only remedy for a typed
   * title or a working time meant in minutes and entered in the wrong unit was deleting
   * the exam and building it again.
   *
   * The paper is deliberately absent. Which questions the exam delivers is fixed when it
   * opens, and editing it afterwards would leave the sittings already scored measured
   * against a paper the exam no longer holds. Correcting a wrong answer key is a separate
   * act with its own endpoint, which re-marks every sitting; it has no screen yet.
   */
  let { data } = $props();

  let submitting = $state(false);

  async function save(settings: Record<string, unknown>) {
    submitting = true;

    try {
      const response = await classroomhub.exam[':examId'].$patch({
        param: { examId: data.examId },
        json: settings
      });
      const body = await response.json();

      if ('success' in body && body.success) {
        snackbar.success($t('exam.settings.updated'));
        goto(resolve(`/courses/${data.courseId}/exams`, {}));
      } else {
        snackbar.error('error' in body ? String(body.error) : $t('exam.settings.update_failed'));
      }
    } finally {
      submitting = false;
    }
  }
</script>

<Page.Root class="mx-auto flex w-[90%] px-4 md:max-w-2xl lg:max-w-3xl">
  <Page.Header>
    <Page.HeaderContent>
      <Page.Title>{$t('exam.settings.edit_title')}</Page.Title>
    </Page.HeaderContent>
  </Page.Header>

  <Page.Body>
    {#snippet child()}
      <div class="ui:space-y-6">
        <ExamTabs courseId={data.courseId} examId={data.examId} />

        <!-- Said once, plainly, instead of disabling fields that are in fact safe to
             change: what a teacher needs to know is which edits reach a sitting that has
             already happened, and only the visibility settings do. -->
        <Alert.Root>
          <Alert.Description>{$t('exam.settings.live_notice')}</Alert.Description>
        </Alert.Root>

        <Alert.Root>
          <Alert.Description>{$t('exam.settings.paper_is_fixed')}</Alert.Description>
        </Alert.Root>

        <ExamSettingsForm
          {submitting}
          initial={data.settings}
          submitLabel={$t('exam.settings.save_changes')}
          onsubmit={save}
        />
      </div>
    {/snippet}
  </Page.Body>
</Page.Root>
