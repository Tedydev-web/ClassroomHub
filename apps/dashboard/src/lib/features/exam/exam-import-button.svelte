<script lang="ts">
  import { goto } from '$app/navigation';
  import { t } from '$lib/utils/functions/translations';
  import { env } from '$env/dynamic/public';
  import { examImportApi } from '$features/course/api';
  import { getResolvedUploadLimits } from '$lib/utils/config/upload-limits-context';
  import { Button } from '@cio/ui/base/button';
  import { Spinner } from '@cio/ui/base/spinner';
  import UploadIcon from '@lucide/svelte/icons/upload';

  /**
   * Importing a paper straight into an exam.
   *
   * A teacher whose questions are in a file used to reach an exam the long way round:
   * create a course exercise from the document, then come back and copy it into a paper.
   * That left the exercise behind in the course tree — visible to enrolled students,
   * untimed — and every question existed twice. Starting the import here says what it is
   * for, and the review screen publishes it as the exam.
   *
   * The file is picked rather than dropped: this sits beside other actions in a toolbar,
   * where a drop zone would take the room a list needs. The importer's own screen is a
   * page away and does the rest.
   */
  let { courseId }: { courseId: string } = $props();

  const enabled = env.PUBLIC_EXAM_IMPORT_ENABLED === 'true';
  const pdfEnabled = env.PUBLIC_EXAM_IMPORT_PDF_ENABLED === 'true';
  const accept = pdfEnabled
    ? '.docx,.pdf,.aiken,.gift,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf'
    : '.docx,.aiken,.gift,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const maxDocumentBytes = getResolvedUploadLimits().documentBytes;

  let input = $state<HTMLInputElement | null>(null);
  const uploading = $derived(examImportApi.isUploading);

  async function choose(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    // Cleared straight away so picking the same file twice still fires a change event.
    if (input) input.value = '';
    if (!file) return;

    const importId = await examImportApi.uploadAndCreate(courseId, file, maxDocumentBytes);
    if (!importId) return;

    // The target rides on the URL rather than in a store: the review screen is a page of
    // its own, reachable by a link a teacher may keep, and it has to publish the same way
    // whenever it is opened.
    await goto(`/courses/${courseId}/exam-imports/${importId}?target=exam`);
  }
</script>

{#if enabled}
  <input bind:this={input} type="file" {accept} class="hidden" onchange={choose} />
  <Button variant="outline" disabled={uploading} onclick={() => input?.click()}>
    {#if uploading}
      <Spinner class="mr-2 size-4" />
    {:else}
      <UploadIcon class="mr-2 size-4" />
    {/if}
    {$t('exam.manage.import_document')}
  </Button>
{/if}
