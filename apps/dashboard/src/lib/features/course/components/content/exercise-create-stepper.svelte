<script lang="ts">
  import { Badge } from '@cio/ui/base/badge';
  import { Skeleton } from '@cio/ui/base/skeleton';
  import { InputField } from '@cio/ui/custom/input-field';
  import { Label } from '@cio/ui/base/label';
  import * as FileDropZone from '@cio/ui/custom/file-drop-zone';
  import type { FileRejectedReason } from '@cio/ui/custom/file-drop-zone';
  import { RadioOptionCardGroup } from '@cio/ui/custom/radio-option-card';
  import { t } from '$lib/utils/functions/translations';
  import { exerciseTemplateApi } from '$features/course/api/exercise-template.svelte';
  import { snackbar } from '$features/ui/snackbar/store';
  import { CloseButton, Confetti, ComingSoon } from '$features/ui';
  import { EXERCISE_TEMPLATE_TAGS } from '$features/course/utils/constants';
  import { courseApi, examImportApi, exerciseApi } from '$features/course/api';
  import { profile } from '$lib/utils/store/user';
  import { lessonDocUpload } from '$features/course/components/lesson/store';
  import { getResolvedUploadLimits } from '$lib/utils/config/upload-limits-context';
  import { env } from '$env/dynamic/public';
  import FileTextIcon from '@lucide/svelte/icons/file-text';
  import { Progress } from '@cio/ui/base/progress';
  import type { StepperState, StepperActions, BaseStepperProps } from './types';
  import { EXERCISE_STEPPER_DEFAULT_STATE, EXERCISE_CREATE_TYPE } from './constants';

  interface Props extends BaseStepperProps {
    stepperState: StepperState;
    onImportCreated: (importId: string) => void;
  }

  let {
    courseId,
    sectionId,
    order,
    onCreated,
    onImportCreated,
    canCreate,
    stepperState = $bindable(EXERCISE_STEPPER_DEFAULT_STATE)
  }: Props = $props();

  const examImportEnabled = env.PUBLIC_EXAM_IMPORT_ENABLED === 'true';
  const examImportPdfEnabled = env.PUBLIC_EXAM_IMPORT_PDF_ENABLED === 'true';
  const examImportAccept = examImportPdfEnabled
    ? '.docx,.pdf,.aiken,.gift,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf'
    : '.docx,.aiken,.gift,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const options = [
    {
      id: 'exercise-from-scratch',
      title: $t('course.navItem.lessons.exercises.new_exercise_modal.options.from_scratch'),
      description: $t('course.navItem.lessons.exercises.new_exercise_modal.options.from_scratch_subtitle'),
      type: EXERCISE_CREATE_TYPE.SCRATCH,
      isDisabled: false
    },
    {
      id: 'exercise-use-template',
      title: $t('course.navItem.lessons.exercises.new_exercise_modal.options.use_template'),
      description: $t('course.navItem.lessons.exercises.new_exercise_modal.options.use_template_subtitle'),
      type: EXERCISE_CREATE_TYPE.TEMPLATE,
      isDisabled: false
    },
    ...(examImportEnabled
      ? [
          {
            id: 'exercise-import-document',
            title: $t('course.navItem.lessons.exercises.new_exercise_modal.options.import_document'),
            description: $t('course.navItem.lessons.exercises.new_exercise_modal.options.import_document_subtitle'),
            type: EXERCISE_CREATE_TYPE.IMPORT,
            isDisabled: false
          }
        ]
      : []),
    {
      id: 'exercise-ai',
      title: $t('course.navItem.lessons.exercises.new_exercise_modal.options.use_ai'),
      description: $t('course.navItem.lessons.exercises.new_exercise_modal.options.use_ai_subtitle'),
      type: EXERCISE_CREATE_TYPE.AI,
      isDisabled: true
    }
  ];

  const radioOptions = $derived(
    options.map((o) => ({
      id: o.id,
      title: o.title,
      description: o.description,
      value: String(o.type),
      disabled: o.isDisabled
    }))
  );

  const tags = Object.values(EXERCISE_TEMPLATE_TAGS);

  let step = $state(0);
  /** String for RadioGroup.Root (component expects string); numeric type derived for logic */
  let typeValue = $state(String(EXERCISE_CREATE_TYPE.SCRATCH));
  const type = $derived(Number(typeValue));
  let isLoading = $state(false);
  let isAIStarted = $state(false);
  let title = $state('');
  let selectedImportFile = $state<File | null>(null);

  let selectedTag = $state(tags[0]);
  let selectedTemplateId = $state('');
  let isTemplateFinishedLoading = $state(false);
  const maxDocumentBytes = getResolvedUploadLimits().documentBytes;

  const templateRadioOptions = $derived(
    (exerciseTemplateApi.templates ?? []).map((t) => ({
      id: String(t.id),
      title: t.title ?? '',
      description: t.description ?? '',
      value: String(t.id),
      disabled: false
    }))
  );

  function handleNext() {
    step = step + 1;
  }

  function handleBack() {
    step = step - 1;
  }

  async function handleTemplateSelection() {
    if (!canCreate) return;
    isTemplateFinishedLoading = true;
    const template = exerciseTemplateApi.templates?.find((t) => t.id === Number(selectedTemplateId));

    if (!template || !template.id) {
      isTemplateFinishedLoading = false;
      return;
    }

    try {
      await exerciseApi.createFromTemplate(courseId, String(template.id), { sectionId, order });
      if (exerciseApi.success && exerciseApi.exercise) {
        const profileId = $profile?.id;
        if (profileId) {
          await courseApi.refreshCourse(courseId, profileId);
        }
        onCreated(exerciseApi.exercise.id);
      }
    } catch (error) {
      console.log('Error creating exercise from template', error);
      snackbar.error($t('course.navItem.lessons.exercises.new_exercise_modal.errors.template_fetch'));
    } finally {
      isTemplateFinishedLoading = false;
    }
  }

  const handleTagSelection = async (tag = selectedTag) => {
    selectedTag = tag;
    selectedTemplateId = '';
    await exerciseTemplateApi.fetchTemplatesByTag(courseId, selectedTag);
  };

  async function handleAddExercise() {
    if (!title.trim() || !canCreate || isLoading) return;

    isLoading = true;
    try {
      await exerciseApi.create(courseId, {
        title: title.trim(),
        sectionId,
        order
      });

      if (exerciseApi.success && exerciseApi.exercise) {
        const profileId = $profile?.id;
        if (profileId) {
          await courseApi.refreshCourse(courseId, profileId);
        }
        onCreated(exerciseApi.exercise.id);
      }
    } finally {
      isLoading = false;
    }
  }

  async function handleImport() {
    if (!selectedImportFile || !canCreate || examImportApi.isUploading) return;

    const importId = await examImportApi.uploadAndCreate(courseId, selectedImportFile, maxDocumentBytes);
    if (importId) onImportCreated(importId);
  }

  async function handleImportFiles(files: File[]) {
    selectedImportFile = files[0] ?? null;
    examImportApi.errors.file = '';
  }

  function handleImportFileRejected({ reason }: { reason: FileRejectedReason; file: File }) {
    const key =
      reason === 'Maximum file size exceeded'
        ? 'exam_import.upload.invalid_size'
        : reason === 'File type not allowed'
          ? examImportPdfEnabled
            ? 'exam_import.upload.document_only'
            : 'exam_import.upload.docx_only'
          : 'exam_import.upload.failed';
    snackbar.error(key);
  }

  function removeImportFile() {
    selectedImportFile = null;
    examImportApi.errors.file = '';
  }

  // ============================================
  // COMPUTED VALUES FOR PARENT
  // ============================================

  const canProceedStep0 = $derived(canCreate);
  const canProceedStep1 = $derived(
    type === EXERCISE_CREATE_TYPE.SCRATCH
      ? title.trim().length > 0 && canCreate
      : type === EXERCISE_CREATE_TYPE.TEMPLATE
        ? !!selectedTemplateId && canCreate
        : type === EXERCISE_CREATE_TYPE.IMPORT
          ? selectedImportFile !== null && canCreate
          : false
  );
  const canProceed = $derived(step === 0 ? canProceedStep0 : canProceedStep1);

  const primaryActionLabel = $derived(
    step === 0
      ? $t('course.navItem.lessons.exercises.new_exercise_modal.next')
      : type === EXERCISE_CREATE_TYPE.IMPORT
        ? $t('course.navItem.lessons.exercises.new_exercise_modal.import.start')
        : $t('course.navItem.lessons.exercises.new_exercise_modal.finish')
  );

  // ============================================
  // SYNC STATE TO BINDABLE (parent has bind:stepperState)
  // Only assign when values change to avoid infinite re-renders.
  // ============================================
  const isSubmitting = $derived(
    isLoading || isTemplateFinishedLoading || examImportApi.isUploading || examImportApi.isLoading
  );
  $effect(() => {
    const next = {
      currentStep: step,
      totalSteps: 2,
      canProceed,
      isSubmitting,
      primaryActionLabel
    };
    if (
      stepperState.currentStep !== next.currentStep ||
      stepperState.canProceed !== next.canProceed ||
      stepperState.isSubmitting !== next.isSubmitting ||
      stepperState.primaryActionLabel !== next.primaryActionLabel
    ) {
      stepperState = next;
    }
  });

  // ============================================
  // EXPORTED ACTIONS
  // ============================================
  export const actions: StepperActions = {
    async next() {
      if (isSubmitting) return;

      if (step === 0) {
        if (type === EXERCISE_CREATE_TYPE.TEMPLATE) {
          handleTagSelection();
        }

        handleNext();
      } else {
        if (type === EXERCISE_CREATE_TYPE.SCRATCH) {
          await handleAddExercise();
        } else if (type === EXERCISE_CREATE_TYPE.TEMPLATE) {
          await handleTemplateSelection();
        } else if (type === EXERCISE_CREATE_TYPE.IMPORT) {
          await handleImport();
        }
      }
    },

    back() {
      handleBack();
    },

    reset() {
      step = 0;
      typeValue = String(EXERCISE_CREATE_TYPE.SCRATCH);
      title = '';
      selectedTag = tags[0];
      selectedTemplateId = '';
      selectedImportFile = null;
      isLoading = false;
      isAIStarted = false;
      isTemplateFinishedLoading = false;
      stepperState = { ...EXERCISE_STEPPER_DEFAULT_STATE };
      exerciseTemplateApi.reset();
      examImportApi.reset();
    }
  };
</script>

{#if !isLoading && isAIStarted}
  <Confetti />
{/if}
{#if step === 0}
  <div>
    <Label class="text-md! mb-3">{$t('course.navItem.lessons.exercises.new_exercise_modal.how')}?</Label>

    <RadioOptionCardGroup bind:value={typeValue} options={radioOptions}>
      {#snippet titleSuffix(option)}
        {#if option.disabled}
          <ComingSoon />
        {/if}
      {/snippet}
    </RadioOptionCardGroup>
  </div>
{:else if step === 1}
  {#if type === EXERCISE_CREATE_TYPE.SCRATCH}
    <div class="w-full">
      <InputField
        label={$t('course.navItem.lessons.exercises.new_exercise_modal.title')}
        bind:value={title}
        autoFocus={true}
        placeholder={$t('course.navItem.lessons.exercises.new_exercise_modal.title_placeholder')}
        className="my-4 w-full"
      />
    </div>
  {:else if type === EXERCISE_CREATE_TYPE.TEMPLATE}
    <div>
      <Label class="text-md mb-1 font-bold">
        {$t('course.navItem.lessons.exercises.new_exercise_modal.select_template')}
      </Label>

      <div>
        <div class="mb-5 flex items-center gap-2">
          {#each tags as tag (tag)}
            <Badge
              variant={selectedTag === tag ? 'default' : 'secondary'}
              class="cursor-pointer"
              onclick={() => handleTagSelection(tag)}
            >
              {tag}
            </Badge>
          {/each}
        </div>

        <div class="max-h-[320px] overflow-y-auto pr-1">
          {#if exerciseTemplateApi.isLoading}
            <div class="grid grid-cols-2 items-start gap-4 lg:grid-cols-3 xl:grid-cols-4">
              {#each Array(16) as _, index (index)}
                <div class="ui:border-border h-[140px] w-full rounded-md border p-5 dark:bg-neutral-700">
                  <div class="flex h-full flex-col justify-evenly">
                    <Skeleton class="h-4 w-3/4" />
                    <div class="flex flex-col items-start justify-between gap-1">
                      <Skeleton class="h-3 w-20" />
                      <Skeleton class="h-3 w-16" />
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          {:else if exerciseTemplateApi.templates?.length}
            <RadioOptionCardGroup
              bind:value={selectedTemplateId}
              options={templateRadioOptions}
              class="grid-cols-2! lg:grid-cols-3! xl:grid-cols-4!"
            />
          {:else}
            <p class="text-sm text-gray-500">
              {$t('course.navItem.lessons.exercises.new_exercise_modal.no_templates_for_tag')}
            </p>
          {/if}
        </div>
      </div>
    </div>
  {:else if type === EXERCISE_CREATE_TYPE.IMPORT}
    <div class="space-y-4">
      <div>
        <Label class="text-md mb-1 font-bold">
          {$t('course.navItem.lessons.exercises.new_exercise_modal.import.heading')}
        </Label>
        <p class="ui:text-muted-foreground text-sm">
          {$t('course.navItem.lessons.exercises.new_exercise_modal.import.description')}
        </p>
      </div>

      {#if selectedImportFile}
        <div class="ui:border-border flex items-center gap-3 rounded-md border p-4">
          <FileTextIcon class="ui:text-muted-foreground size-5 shrink-0" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{selectedImportFile.name}</p>
            <p class="ui:text-muted-foreground text-xs">{FileDropZone.displaySize(selectedImportFile.size)}</p>
          </div>
          <CloseButton onClick={removeImportFile} />
        </div>
      {:else}
        <FileDropZone.Root
          accept={examImportAccept}
          maxFiles={1}
          fileCount={0}
          maxFileSize={maxDocumentBytes}
          onUpload={handleImportFiles}
          onFileRejected={handleImportFileRejected}
        >
          <FileDropZone.Trigger
            label={$t('course.navItem.lessons.exercises.new_exercise_modal.import.drop_label')}
            formatMaxFiles={(_count) =>
              $t('course.navItem.lessons.exercises.new_exercise_modal.import.drop_description')}
            formatMaxFilesAndSize={(size) =>
              $t('course.navItem.lessons.exercises.new_exercise_modal.import.max_size', { size })}
            formatMaxSize={(size) =>
              $t('course.navItem.lessons.exercises.new_exercise_modal.import.max_size', { size })}
          />
        </FileDropZone.Root>
      {/if}

      {#if examImportApi.errors.file}
        <p class="ui:text-destructive text-sm" role="alert">{$t(examImportApi.errors.file)}</p>
      {/if}

      {#if $lessonDocUpload.isUploading}
        <div class="space-y-2" aria-live="polite">
          <div class="flex items-center justify-between text-sm">
            <span>{$t('course.navItem.lessons.exercises.new_exercise_modal.import.uploading')}</span>
            <span>{$lessonDocUpload.uploadProgress}%</span>
          </div>
          <Progress value={$lessonDocUpload.uploadProgress} />
        </div>
      {/if}
    </div>
  {/if}
{/if}
