<script lang="ts">
  import { getExerciseQuestionLabel, type ExerciseQuestionRendererProps } from '@cio/question-types';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import { DocumentCard } from '../../../document-card';
  import { Button } from '../../../../base/button';
  import { Spinner } from '../../../../base/spinner';
  import {
    formatAcceptedFileTypes,
    isFileSizeAllowed,
    isFileTypeAllowed,
    normalizeAcceptedFileTypes
  } from '../file-upload-types';

  let {
    question,
    answer = null,
    disabled = false,
    labels,
    platformMaxFileSizeMb,
    onAnswerChange = () => {},
    onFileUpload
  }: ExerciseQuestionRendererProps = $props();

  const label = (key: Parameters<typeof getExerciseQuestionLabel>[1], fallback = '') =>
    getExerciseQuestionLabel(labels, key, fallback);

  let fileInput = $state<HTMLInputElement | null>(null);
  let isUploading = $state(false);
  let uploadError = $state<string | null>(null);

  const acceptedTypes = $derived(normalizeAcceptedFileTypes(question.settings?.acceptedTypes));
  const acceptAttribute = $derived(acceptedTypes.join(','));
  const maxSizeMb = $derived(question.settings?.maxSizeMb as number | undefined);

  const uploadedFile = $derived.by(
    (): {
      fileName: string;
      fileUrl: string | null;
      mimeType?: string;
      size?: number;
    } | null => {
      if (answer?.type !== 'FILE_UPLOAD') return null;
      const name = answer.fileName?.trim() ?? '';
      if (!name) return null;
      const url =
        typeof (answer as { fileUrl?: string }).fileUrl === 'string' ? (answer as { fileUrl?: string }).fileUrl : null;
      return {
        fileName: name,
        fileUrl: url ?? null,
        mimeType: answer.mimeType,
        size: answer.size
      };
    }
  );

  function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  const fileTypeLabel = $derived.by(() => {
    const mime = uploadedFile?.mimeType ?? '';
    if (mime.includes('pdf')) return 'PDF';
    if (mime.includes('wordprocessingml') || mime.includes('docx')) return 'DOCX';
    if (mime.includes('msword') || mime.includes('doc')) return 'DOC';
    if (mime.includes('image')) return 'IMAGE';
    if (mime.includes('video')) return 'VIDEO';
    return mime.split('/')[1]?.toUpperCase() ?? 'FILE';
  });

  const subtitle = $derived(
    uploadedFile
      ? [fileTypeLabel, uploadedFile.size != null ? formatFileSize(uploadedFile.size) : null]
          .filter(Boolean)
          .join(' · ') || '–'
      : ''
  );

  function openFilePicker() {
    if (disabled || isUploading) return;
    uploadError = null;
    fileInput?.click();
  }

  async function onFileSelected(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const selectedFile = input.files?.[0];
    input.value = '';

    if (!selectedFile) return;
    if (!isFileTypeAllowed(selectedFile, acceptedTypes)) return;
    if (!isFileSizeAllowed(selectedFile, maxSizeMb, platformMaxFileSizeMb)) return;

    if (!onFileUpload) return;

    isUploading = true;
    uploadError = null;
    try {
      const result = await onFileUpload({ questionId: question.id, file: selectedFile });
      onAnswerChange(result);
    } catch (err) {
      uploadError = err instanceof Error ? err.message : label('file_upload.take.upload_error', 'Upload failed');
    } finally {
      isUploading = false;
    }
  }
</script>

<div class="ui:space-y-2">
  <input
    bind:this={fileInput}
    type="file"
    accept={acceptAttribute || undefined}
    hidden
    class="ui:hidden"
    disabled={disabled || isUploading}
    onchange={onFileSelected}
  />
  <Button type="button" variant="outline" disabled={disabled || isUploading} onclick={openFilePicker}>
    {#if isUploading}
      <Spinner class="ui:size-4" />
      {label('file_upload.take.upload_progress', 'Uploading...')}
    {:else}
      <PlusIcon class="ui:size-4" />
      {label('file_upload.take.upload_button')}
    {/if}
  </Button>
  <!--
    What the upload has to satisfy, said before it is attempted. Both values were already
    computed here — one feeds the input's `accept`, the other the size check — and both were
    shown to the author in preview, but the person who has to meet them saw only a button and
    found out by being rejected afterwards.
  -->
  {#if acceptedTypes.length > 0 || maxSizeMb}
    <p class="ui:text-muted-foreground ui:text-xs">
      {#if acceptedTypes.length > 0}
        {label('file_upload.preview.accepted_types_label')}: {formatAcceptedFileTypes(acceptedTypes)}
      {/if}
      {#if acceptedTypes.length > 0 && maxSizeMb}
        &middot;
      {/if}
      {#if maxSizeMb}
        {label('file_upload.preview.max_size_label')}: {maxSizeMb}
      {/if}
    </p>
  {/if}
  {#if uploadError}
    <p class="ui:text-destructive ui:text-xs">{uploadError}</p>
  {/if}
  {#if uploadedFile}
    <DocumentCard
      title={uploadedFile.fileName}
      {subtitle}
      fileUrl={uploadedFile.fileUrl}
      viewLabel={label('file_upload.take.view', 'View')}
      downloadLabel={label('file_upload.take.download', 'Download')}
    />
  {/if}
</div>
