<script lang="ts">
  import { Button } from '@cio/ui/base/button';
  import * as Field from '@cio/ui/base/field';
  import { InputField } from '@cio/ui/custom/input-field';
  import { RichTextField } from '$features/ui';
  import { examImportApi } from '$features/course/api';
  import type { ExamImportDraft, ExamImportDraftPatchOperation } from '$features/course/utils/types';
  import { untrack } from 'svelte';
  import { t } from '$lib/utils/functions/translations';

  interface Props {
    courseId: string;
    importId: string;
    draft: ExamImportDraft;
  }

  let { courseId, importId, draft }: Props = $props();

  const initialDraft = untrack(() => draft);
  let title = $state(initialDraft.title);
  let sectionDrafts = $state(initialDraft.sections.map((section) => ({ id: section.id, title: section.title })));
  let sharedContentDrafts = $state(
    initialDraft.sharedContents.map((content) => ({
      id: content.id,
      kind: content.kind,
      html: content.html
    }))
  );

  async function saveSettings() {
    const operations: ExamImportDraftPatchOperation[] = [];
    if (title !== draft.title) {
      operations.push({ target: { kind: 'draft_field', field: 'title' }, value: title });
    }
    for (const section of sectionDrafts) {
      const original = draft.sections.find((candidate) => candidate.id === section.id);
      if (original && section.title !== original.title) {
        operations.push({
          target: { kind: 'section_field', sectionId: section.id, field: 'title' },
          value: section.title
        });
      }
    }
    for (const content of sharedContentDrafts) {
      const original = draft.sharedContents.find((candidate) => candidate.id === content.id);
      if (original && content.html !== original.html) {
        operations.push({
          target: { kind: 'shared_content_field', contentId: content.id, field: 'html' },
          value: content.html
        });
      }
    }

    if (operations.length > 0) await examImportApi.patchDraft(courseId, importId, operations);
  }
</script>

<section class="space-y-5" aria-labelledby="exam-import-document-settings">
  <div>
    <h2 id="exam-import-document-settings" class="text-base font-semibold">
      {$t('exam_import.review.document_settings')}
    </h2>
    <p class="ui:text-muted-foreground text-sm">{$t('exam_import.review.document_settings_description')}</p>
  </div>

  <Field.Group>
    <Field.Set>
      <Field.Legend>{$t('exam_import.review.exercise_structure')}</Field.Legend>
      <Field.Group>
        <InputField label={$t('exam_import.review.exercise_title')} bind:value={title} isRequired />
        {#each sectionDrafts as section, index (section.id)}
          <InputField
            label={$t('exam_import.review.section_title', { number: index + 1 })}
            bind:value={section.title}
            isRequired
          />
        {/each}
      </Field.Group>
    </Field.Set>

    {#if sharedContentDrafts.length > 0}
      <Field.Separator />
      <Field.Set>
        <Field.Legend>{$t('exam_import.review.shared_contents')}</Field.Legend>
        <Field.Description>{$t('exam_import.review.shared_contents_description')}</Field.Description>
        <Field.Group>
          {#each sharedContentDrafts as content, index (content.id)}
            <RichTextField
              label={$t(`exam_import.review.shared_content_${content.kind}`, { number: index + 1 })}
              bind:value={content.html}
              variant="full"
              isRequired
            />
          {/each}
        </Field.Group>
      </Field.Set>
    {/if}
  </Field.Group>

  <div class="flex justify-end">
    <Button onclick={saveSettings} loading={examImportApi.isLoading}>
      {$t('exam_import.review.save_structure')}
    </Button>
  </div>
</section>
