<script lang="ts">
  import ExamSettingsForm from '$features/exam/exam-settings-form.svelte';
  import { classroomhub } from '$lib/utils/services/api';
  import { snackbar } from '$lib/components/Snackbar/store';

  /**
   * Creating an exam from a paper that already exists as a detached container — one the
   * `.docx` import produced, or a duplicate of a working exercise. The exam is created in
   * draft; opening it is a separate act, because that is when its paper freezes.
   */
  let { data } = $props();

  let submitting = $state(false);
  // Derived from the loader with a local override, for the same reason as everywhere else
  // in this feature: state seeded from `data` freezes at mount.
  let chosen = $state<string | null>(null);
  const exerciseId = $derived(chosen ?? data.containers[0]?.id ?? '');

  async function create(settings: Record<string, unknown>) {
    if (!exerciseId) {
      snackbar.error('Chọn một bộ câu hỏi cho đề thi này');
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
        snackbar.success('Đã tạo đề thi ở dạng nháp. Mở đề khi bạn sẵn sàng gửi link.');
        window.location.href = `/courses/${data.courseId}/exams`;
      } else {
        snackbar.error('error' in body ? String(body.error) : 'Không tạo được đề thi');
      }
    } finally {
      submitting = false;
    }
  }
</script>

<div class="ui:mx-auto ui:w-full ui:max-w-3xl ui:space-y-6 ui:px-4 ui:py-6">
  <h1 class="ui:text-xl ui:font-semibold">Tạo đề thi</h1>

  {#if data.containers.length === 0}
    <p class="ui:text-muted-foreground ui:text-sm">
      Chưa có bộ câu hỏi nào dùng được. Import một file .docx trước, rồi quay lại đây.
    </p>
  {:else}
    <div class="ui:space-y-2">
      <label class="ui:text-sm ui:font-medium" for="exam-container">Bộ câu hỏi</label>
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
