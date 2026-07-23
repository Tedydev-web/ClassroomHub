<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { TextEditor } from '$features/ui';
  import { exerciseApi } from '$features/course/api';
  import { t } from '$lib/utils/functions/translations';
  import { snackbar } from '$features/ui/snackbar/store';
  import { Button } from '@cio/ui/base/button';
  import { AssessmentItemRenderer } from '@cio/ui/custom/exercise-question';
  import { Checkbox } from '@cio/ui/base/checkbox';
  import * as Field from '@cio/ui/base/field';
  import { InputField } from '@cio/ui/custom/input-field';
  import { IconButton } from '@cio/ui/custom/icon-button';
  import { Label } from '@cio/ui/base/label';
  import * as Select from '@cio/ui/base/select';
  import type { TiptapEditor } from '@cio/ui/custom/editor';
  import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
  import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import TrashIcon from '@lucide/svelte/icons/trash';
  import {
    deriveItemCapabilities,
    getItemMaxScore,
    parseAssessmentItemDefinition,
    toAssessmentDeliveryDefinition,
    validateAssessmentItemForPublish,
    type AssessmentGradingMode,
    type AssessmentIssue,
    type AssessmentItemDefinition
  } from '@cio/question-types';
  import {
    addChoiceInteractionBlock,
    addContentBlock,
    addTextInteractionBlock,
    createAssessmentComposerState,
    getAssessmentComposerSnapshot,
    reconcileAssessmentComposerSave,
    removeAssessmentBlock,
    reorderAssessmentBlock,
    setAssessmentItemPresentationLayout,
    setChoiceCorrectOption,
    setChoiceInteractionCardinality,
    type AssessmentComposerState
  } from '$features/course/utils/assessment-composer-state';
  import {
    removeAssessmentComposerPreviewItem,
    registerAssessmentComposerMutationHandler,
    registerAssessmentComposerSaveHandler,
    setAssessmentComposerDirty,
    setAssessmentComposerPreviewItem
  } from '$features/course/components/exercise/store';
  import type { CanonicalQuestionState } from '$features/course/components/exercise/store';
  import type { TAssessmentItemMutation } from '@cio/utils/validation/exercise';

  interface Props {
    courseId: string;
    exerciseId: string;
    questionId?: number;
    exerciseSectionId?: string | null;
    initialOrder?: number;
    initialTitle?: string;
    initialDefinition?: AssessmentItemDefinition | null;
    initialRevision?: number;
    onSaveRequested: () => Promise<void>;
    onSaved?: (item: {
      questionId: number;
      title: string;
      order: number | null;
      exerciseSectionId: string | null;
      points: number;
      gradingMode: AssessmentGradingMode;
      revisionId: string;
      revision: number;
      definition: ReturnType<typeof toAssessmentDeliveryDefinition>;
      authorDefinition: AssessmentItemDefinition;
      hasNewerDraft: boolean;
    }) => Promise<void> | void;
  }

  let {
    courseId,
    exerciseId,
    questionId,
    exerciseSectionId,
    initialOrder = 0,
    initialTitle = '',
    initialDefinition = null,
    initialRevision,
    onSaveRequested,
    onSaved = () => {}
  }: Props = $props();
  let composer = $state<AssessmentComposerState>(createAssessmentComposerState());
  let activeQuestionId = $state<number | undefined>();
  let title = $state('');
  let revision = $state(0);
  let isLoading = $state(true);
  let isSaving = $state(false);
  let persistedSnapshot = $state('');
  let titleError = $state('');
  let validationIssues = $state<AssessmentIssue[]>([]);
  let pendingValidationFocusId: string | null = null;
  let pendingAtomicSave: {
    submittedSnapshot: string;
    submittedTitle: string;
  } | null = null;
  const textEditors = new SvelteMap<string, TiptapEditor>();
  const composerInstanceId = $props.id();
  const composerRegistrationId = $derived(`${exerciseId}:${activeQuestionId ?? composerInstanceId}`);

  function getDraftSnapshot(): string {
    return getAssessmentComposerSnapshot(title, composer.definition);
  }

  const isDirty = $derived(!isLoading && getDraftSnapshot() !== persistedSnapshot);

  $effect(() => {
    setAssessmentComposerDirty(composerRegistrationId, isDirty);
  });

  $effect(() => registerAssessmentComposerSaveHandler(composerRegistrationId, save));

  $effect(() =>
    registerAssessmentComposerMutationHandler(composerRegistrationId, {
      prepare: prepareAtomicMutation,
      reconcile: reconcileAtomicMutation
    })
  );

  $effect(() => {
    if (isLoading) {
      removeAssessmentComposerPreviewItem(composerRegistrationId);
      return;
    }

    const points = getItemMaxScore(composer.definition);
    const gradingMode = deriveItemCapabilities(composer.definition).gradingMode;
    const definition = toAssessmentDeliveryDefinition(composer.definition);
    setAssessmentComposerPreviewItem(composerRegistrationId, {
      exerciseId,
      questionId: activeQuestionId ?? null,
      title,
      points,
      order: initialOrder,
      exerciseSectionId: exerciseSectionId ?? null,
      gradingMode,
      definition
    });

    return () => removeAssessmentComposerPreviewItem(composerRegistrationId);
  });

  function createId(): string {
    return crypto.randomUUID();
  }

  function getComposerDomId(): string {
    return `assessment-${questionId ?? 'new'}`;
  }

  function getBlockDomId(blockId: string, field: string): string {
    return `${getComposerDomId()}-${blockId}-${field}`;
  }

  function issuePathStartsWith(issue: AssessmentIssue, path: Array<string | number>): boolean {
    return path.every((segment, index) => issue.path[index] === segment);
  }

  function issuePathEquals(issue: AssessmentIssue, path: Array<string | number>): boolean {
    return issue.path.length === path.length && issuePathStartsWith(issue, path);
  }

  function getValidationError(path: Array<string | number>, required = false): string {
    if (!validationIssues.some((issue) => issuePathStartsWith(issue, path))) return '';

    return t.get(required ? 'validation.generic.required_field' : 'validation.generic.invalid_field');
  }

  function getExactValidationError(path: Array<string | number>): string {
    if (!validationIssues.some((issue) => issuePathEquals(issue, path))) return '';

    return t.get('validation.generic.invalid_field');
  }

  function clearValidationState() {
    titleError = '';
    validationIssues = [];
    pendingValidationFocusId = null;
  }

  function setTextEditorLabel(editor: TiptapEditor, label: string) {
    if (editor.isDestroyed) return;

    editor.view.dom.setAttribute('aria-label', label);
  }

  function syncTextEditorAccessibility(targetId: string, editor: TiptapEditor) {
    if (editor.isDestroyed) return;

    const blockIndex = composer.definition.blocks.findIndex((block) => getBlockDomId(block.id, 'prompt') === targetId);
    const error = blockIndex >= 0 ? getValidationError(['blocks', blockIndex, 'interaction', 'prompt'], true) : '';
    const editorElement = editor.view.dom;
    setTextEditorLabel(editor, t.get('course.navItem.lessons.exercises.all_exercises.assessment_item.prompt'));

    if (error) {
      editorElement.setAttribute('aria-invalid', 'true');
      editorElement.setAttribute('aria-describedby', `${targetId}-error`);
      return;
    }

    editorElement.removeAttribute('aria-invalid');
    editorElement.removeAttribute('aria-describedby');
  }

  function registerTextEditor(targetId: string, editor: TiptapEditor) {
    textEditors.set(targetId, editor);
    syncTextEditorAccessibility(targetId, editor);

    if (pendingValidationFocusId !== targetId) return;

    requestAnimationFrame(() => {
      if (editor.isDestroyed || pendingValidationFocusId !== targetId) return;

      editor.commands.focus();
      pendingValidationFocusId = null;
    });
  }

  function getValidationFocusId(issue: AssessmentIssue): string {
    const blockIndex = issue.path[0] === 'blocks' && typeof issue.path[1] === 'number' ? issue.path[1] : null;
    if (blockIndex === null) return `${getComposerDomId()}-actions`;

    const block = composer.definition.blocks[blockIndex];
    if (!block) return `${getComposerDomId()}-actions`;

    if (issue.path.includes('prompt')) return getBlockDomId(block.id, 'prompt');
    if (issue.path.includes('maxScore')) return getBlockDomId(block.id, 'points');

    if (block.kind === 'interaction' && block.interaction.kind === 'choice') {
      const optionsPathIndex = issue.path.indexOf('options');
      const optionIndex = optionsPathIndex >= 0 ? issue.path[optionsPathIndex + 1] : null;
      if (typeof optionIndex === 'number') {
        const option = block.interaction.config.options[optionIndex];
        if (option) return getBlockDomId(option.id, 'label');
      }

      if (optionsPathIndex >= 0) return getBlockDomId(block.id, 'add-option');

      if (issue.path.includes('correctOptionIds')) {
        const firstOption = block.interaction.config.options[0];
        if (firstOption) return getBlockDomId(firstOption.id, 'correct');
      }
    }

    return getBlockDomId(block.id, 'block');
  }

  function focusValidationTarget(targetId: string) {
    pendingValidationFocusId = targetId;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const editor = textEditors.get(targetId);
        if (editor && !editor.isDestroyed) {
          editor.commands.focus();
          pendingValidationFocusId = null;
          return;
        }

        const target = document.getElementById(targetId);
        target?.focus();
        if (!target?.hasAttribute('data-assessment-text-prompt')) pendingValidationFocusId = null;
      });
    });
  }

  $effect(() => {
    if (validationIssues.length === 0 && textEditors.size === 0) return;

    for (const [targetId, editor] of textEditors) {
      syncTextEditorAccessibility(targetId, editor);
    }
  });

  function validateDraft(): AssessmentItemDefinition | null {
    clearValidationState();

    if (title.trim() === '') {
      titleError = t.get('validation.generic.required_field');
      snackbar.error(titleError);
      focusValidationTarget(`${getComposerDomId()}-title`);
      return null;
    }

    const parsedDefinition = parseAssessmentItemDefinition(composer.definition);
    if (!parsedDefinition.success) {
      validationIssues = parsedDefinition.issues;
      snackbar.error(t.get('validation.generic.invalid_field'));
      const firstIssue = parsedDefinition.issues[0];
      if (firstIssue) focusValidationTarget(getValidationFocusId(firstIssue));
      return null;
    }

    const publishable = validateAssessmentItemForPublish(parsedDefinition.data);
    if (!publishable.success) {
      validationIssues = publishable.issues;
      snackbar.error(t.get('validation.generic.invalid_field'));
      const firstIssue = publishable.issues[0];
      if (firstIssue) focusValidationTarget(getValidationFocusId(firstIssue));
      return null;
    }

    return publishable.data;
  }

  function prepareAtomicMutation(): TAssessmentItemMutation | null {
    const definition = validateDraft();
    if (!definition) return null;

    const submittedTitle = title;
    const submittedSnapshot = getAssessmentComposerSnapshot(submittedTitle, definition);
    pendingAtomicSave = { submittedSnapshot, submittedTitle };
    if (activeQuestionId !== undefined) {
      return {
        action: 'publish',
        clientMutationId: composerRegistrationId,
        questionId: activeQuestionId,
        title: submittedTitle,
        expectedRevision: revision,
        definition
      };
    }

    return {
      action: 'create',
      clientMutationId: composerRegistrationId,
      title: submittedTitle,
      exerciseSectionId: exerciseSectionId ?? null,
      order: initialOrder,
      definition
    };
  }

  async function reconcileAtomicMutation(savedQuestion: CanonicalQuestionState): Promise<void> {
    const pendingSave = pendingAtomicSave;
    const savedDefinition = savedQuestion.authorDefinition;
    if (!pendingSave || !savedDefinition) {
      throw new Error(`Missing saved assessment definition for composer "${composerRegistrationId}"`);
    }

    revision = savedQuestion.revision;
    const reconciliation = reconcileAssessmentComposerSave({
      currentTitle: title,
      currentDefinition: composer.definition,
      submittedSnapshot: pendingSave.submittedSnapshot,
      submittedTitle: pendingSave.submittedTitle,
      savedDefinition
    });
    activeQuestionId = Number(savedQuestion.id);
    if (reconciliation.shouldApplySavedDefinition) {
      composer = { definition: savedDefinition, selectedBlockId: null };
    }
    persistedSnapshot = reconciliation.persistedSnapshot;
    pendingAtomicSave = null;
    await onSaved({
      questionId: Number(savedQuestion.id),
      title: savedQuestion.title,
      order: savedQuestion.order,
      exerciseSectionId: savedQuestion.exerciseSectionId,
      points: Number(savedQuestion.points ?? 0),
      gradingMode: savedQuestion.gradingMode,
      revisionId: savedQuestion.revisionId,
      revision: savedQuestion.revision,
      definition: savedQuestion.definition,
      authorDefinition: savedDefinition,
      hasNewerDraft: !reconciliation.shouldApplySavedDefinition
    });
  }

  function updateComposer(nextComposer: AssessmentComposerState) {
    clearValidationState();
    composer = nextComposer;
  }

  function updateDefinition(nextDefinition: AssessmentItemDefinition) {
    updateComposer({ ...composer, definition: nextDefinition });
  }

  function updatePresentationLayout(value: string) {
    if (value !== 'flow' && value !== 'passage_split') return;

    updateComposer(setAssessmentItemPresentationLayout(composer, value));
  }

  function updateBlock(
    blockId: string,
    update: (block: AssessmentItemDefinition['blocks'][number]) => AssessmentItemDefinition['blocks'][number]
  ) {
    updateDefinition({
      ...composer.definition,
      blocks: composer.definition.blocks.map((block) => (block.id === blockId ? update(block) : block))
    });
  }

  function moveBlock(blockId: string, offset: -1 | 1) {
    const sourceIndex = composer.definition.blocks.findIndex((block) => block.id === blockId);
    if (sourceIndex < 0) return;

    updateComposer(reorderAssessmentBlock(composer, blockId, sourceIndex + offset));
  }

  function addChoiceOption(blockId: string) {
    updateBlock(blockId, (block) => {
      if (block.kind !== 'interaction' || block.interaction.kind !== 'choice') return block;

      return {
        ...block,
        interaction: {
          ...block.interaction,
          config: {
            ...block.interaction.config,
            options: [...block.interaction.config.options, { id: createId(), html: '' }]
          }
        }
      };
    });
  }

  function removeChoiceOption(blockId: string, optionId: string) {
    updateBlock(blockId, (block) => {
      if (block.kind !== 'interaction' || block.interaction.kind !== 'choice') return block;

      return {
        ...block,
        interaction: {
          ...block.interaction,
          config: {
            ...block.interaction.config,
            options: block.interaction.config.options.filter((option) => option.id !== optionId),
            correctOptionIds: block.interaction.config.correctOptionIds.filter(
              (correctOptionId) => correctOptionId !== optionId
            )
          }
        }
      };
    });
  }

  function removeBlock(blockId: string) {
    textEditors.delete(getBlockDomId(blockId, 'prompt'));
    updateComposer(removeAssessmentBlock(composer, blockId));
  }

  async function loadExistingItem() {
    title = initialTitle;
    if (!questionId) {
      persistedSnapshot = getDraftSnapshot();
      isLoading = false;
      return;
    }
    if (initialDefinition && initialRevision !== undefined) {
      composer = { definition: initialDefinition, selectedBlockId: null };
      revision = initialRevision;
      persistedSnapshot = getDraftSnapshot();
      isLoading = false;

      return;
    }

    try {
      const result = await exerciseApi.getAssessmentItem(courseId, exerciseId, questionId);
      if (!result?.data) {
        console.error(`Failed to load assessment item "${questionId}"`);
        snackbar.error();
        return;
      }

      title = result.data.title;
      composer = { definition: result.data.definition as AssessmentItemDefinition, selectedBlockId: null };
      revision = result.data.revision;
      persistedSnapshot = getDraftSnapshot();
    } catch (error) {
      console.error(`Failed to load assessment item "${questionId}":`, error);
      snackbar.error();
    } finally {
      isLoading = false;
    }
  }

  async function save(): Promise<boolean> {
    if (isSaving) return false;
    if (!validateDraft()) return false;

    isSaving = true;
    try {
      await onSaveRequested();
      return true;
    } catch (error) {
      console.error(`Failed to request exercise save for assessment item "${activeQuestionId ?? 'new'}":`, error);
      snackbar.error();
      return false;
    } finally {
      isSaving = false;
    }
  }

  onMount(() => {
    activeQuestionId = questionId;
    void loadExistingItem();
  });
</script>

<section class="space-y-4 rounded-md border p-4">
  <InputField
    bind:value={title}
    name={`${getComposerDomId()}-title`}
    label={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.title')}
    placeholder={$t('course.navItem.lessons.exercises.all_exercises.write_your_question_here')}
    errorMessage={titleError}
    oninput={clearValidationState}
  />

  <Field.Field>
    <Field.Label for={`${getComposerDomId()}-layout`}>
      {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.layout')}
    </Field.Label>
    <Select.Root
      type="single"
      value={composer.definition.presentation?.layout ?? 'flow'}
      onValueChange={updatePresentationLayout}
    >
      <Select.Trigger id={`${getComposerDomId()}-layout`} class="w-full">
        {composer.definition.presentation?.layout === 'passage_split'
          ? $t('course.navItem.lessons.exercises.all_exercises.assessment_item.layout_passage_split')
          : $t('course.navItem.lessons.exercises.all_exercises.assessment_item.layout_flow')}
      </Select.Trigger>
      <Select.Content>
        <Select.Item value="flow">
          {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.layout_flow')}
        </Select.Item>
        <Select.Item value="passage_split">
          {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.layout_passage_split')}
        </Select.Item>
      </Select.Content>
    </Select.Root>
  </Field.Field>

  {#if isLoading}
    <div class="ui:animate-pulse ui:h-24 ui:rounded ui:bg-muted"></div>
  {:else}
    <div id={`${getComposerDomId()}-actions`} class="flex flex-wrap gap-2" tabindex="-1">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onclick={() => updateComposer(addContentBlock(composer, createId))}
      >
        <PlusIcon class="h-4 w-4" />
        {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.add_content')}
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onclick={() => updateComposer(addChoiceInteractionBlock(composer, createId))}
      >
        <PlusIcon class="h-4 w-4" />
        {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.add_choice')}
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onclick={() => updateComposer(addTextInteractionBlock(composer, createId))}
      >
        <PlusIcon class="h-4 w-4" />
        {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.add_text')}
      </Button>
    </div>

    {#each composer.definition.blocks as block, blockIndex (block.id)}
      <div id={getBlockDomId(block.id, 'block')} class="space-y-4 rounded border p-4" tabindex="-1">
        <div class="flex items-center justify-end gap-1">
          <IconButton
            variant="secondary"
            disabled={blockIndex === 0}
            onclick={() => moveBlock(block.id, -1)}
            tooltip={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.move_up')}
          >
            <ArrowUpIcon class="h-4 w-4" />
          </IconButton>
          <IconButton
            variant="secondary"
            disabled={blockIndex === composer.definition.blocks.length - 1}
            onclick={() => moveBlock(block.id, 1)}
            tooltip={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.move_down')}
          >
            <ArrowDownIcon class="h-4 w-4" />
          </IconButton>
          <IconButton
            variant="secondary"
            onclick={() => removeBlock(block.id)}
            tooltip={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.remove')}
          >
            <TrashIcon class="h-4 w-4" />
          </IconButton>
        </div>

        {#if block.kind === 'content'}
          <div
            role="group"
            aria-label={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.content_placeholder')}
          >
            <TextEditor
              content={block.content.html}
              placeholder={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.content_placeholder')}
              onReady={(editor) =>
                setTextEditorLabel(
                  editor,
                  t.get('course.navItem.lessons.exercises.all_exercises.assessment_item.content_placeholder')
                )}
              onChange={(content) =>
                updateBlock(block.id, (currentBlock) =>
                  currentBlock.kind === 'content'
                    ? { ...currentBlock, content: { ...currentBlock.content, html: `${content}` } }
                    : currentBlock
                )}
            />
          </div>
        {:else if block.interaction.kind === 'choice'}
          <InputField
            bind:value={block.interaction.prompt.html}
            name={getBlockDomId(block.id, 'prompt')}
            label={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.prompt')}
            errorMessage={getValidationError(['blocks', blockIndex, 'interaction', 'prompt'], true)}
            oninput={clearValidationState}
          />
          <InputField
            bind:value={block.interaction.maxScore}
            name={getBlockDomId(block.id, 'points')}
            label={$t('course.navItem.lessons.exercises.new_exercise_modal.points')}
            type="number"
            min="0"
            step="0.01"
            errorMessage={getValidationError(['blocks', blockIndex, 'interaction', 'maxScore'])}
            oninput={clearValidationState}
          />
          <div class="flex items-center gap-2">
            <Checkbox
              id={getBlockDomId(block.id, 'multiple')}
              checked={block.interaction.config.cardinality === 'multiple'}
              onCheckedChange={(checked) =>
                updateComposer(
                  setChoiceInteractionCardinality(composer, block.id, checked === true ? 'multiple' : 'single')
                )}
            />
            <Label for={getBlockDomId(block.id, 'multiple')} class="cursor-pointer font-normal">
              {$t('course.navItem.lessons.exercises.all_exercises.edit_mode.question_types.multiple')}
            </Label>
          </div>
          {@const correctOptionError = getValidationError([
            'blocks',
            blockIndex,
            'interaction',
            'config',
            'correctOptionIds'
          ])}
          {@const optionsError = getExactValidationError(['blocks', blockIndex, 'interaction', 'config', 'options'])}
          <div
            class="space-y-2"
            role="group"
            aria-describedby={correctOptionError ? getBlockDomId(block.id, 'correct-error') : undefined}
          >
            {#each block.interaction.config.options as option, optionIndex (option.id)}
              <div class="flex items-center gap-2">
                <Checkbox
                  id={getBlockDomId(option.id, 'correct')}
                  aria-label={`${$t(
                    'course.navItem.lessons.exercises.all_exercises.shared_question.checkbox.edit.toggle_correct_sr'
                  )}: ${$t('course.navItem.lessons.exercises.all_exercises.assessment_item.option', {
                    index: optionIndex + 1
                  })}`}
                  aria-invalid={correctOptionError ? 'true' : undefined}
                  aria-describedby={correctOptionError ? getBlockDomId(block.id, 'correct-error') : undefined}
                  checked={block.interaction.config.correctOptionIds.includes(option.id)}
                  onCheckedChange={(checked) =>
                    updateComposer(setChoiceCorrectOption(composer, block.id, option.id, checked === true))}
                />
                <InputField
                  bind:value={option.html}
                  name={getBlockDomId(option.id, 'label')}
                  label={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.option', {
                    index: optionIndex + 1
                  })}
                  errorMessage={getValidationError(
                    ['blocks', blockIndex, 'interaction', 'config', 'options', optionIndex, 'html'],
                    true
                  )}
                  oninput={clearValidationState}
                />
                <IconButton
                  variant="secondary"
                  disabled={block.interaction.config.options.length <= 2}
                  onclick={() => removeChoiceOption(block.id, option.id)}
                  tooltip={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.remove')}
                >
                  <TrashIcon class="h-4 w-4" />
                </IconButton>
              </div>
            {/each}
            {#if optionsError}
              <Field.Error id={getBlockDomId(block.id, 'options-error')}>{optionsError}</Field.Error>
            {/if}
            {#if correctOptionError}
              <Field.Error id={getBlockDomId(block.id, 'correct-error')}>{correctOptionError}</Field.Error>
            {/if}
          </div>
          <Button
            id={getBlockDomId(block.id, 'add-option')}
            type="button"
            variant="secondary"
            size="sm"
            aria-describedby={optionsError ? getBlockDomId(block.id, 'options-error') : undefined}
            onclick={() => addChoiceOption(block.id)}
          >
            <PlusIcon class="h-4 w-4" />
            {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.add_option')}
          </Button>
        {:else if block.interaction.kind === 'text'}
          {@const textPromptError = getValidationError(['blocks', blockIndex, 'interaction', 'prompt'], true)}
          <div
            id={getBlockDomId(block.id, 'prompt')}
            role="group"
            aria-label={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.prompt')}
            aria-describedby={textPromptError ? getBlockDomId(block.id, 'prompt-error') : undefined}
            data-assessment-text-prompt={block.id}
            tabindex="-1"
          >
            <TextEditor
              content={block.interaction.prompt.html}
              placeholder={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.prompt')}
              onReady={(editor) => registerTextEditor(getBlockDomId(block.id, 'prompt'), editor)}
              onChange={(content) =>
                updateBlock(block.id, (currentBlock) =>
                  currentBlock.kind === 'interaction' && currentBlock.interaction.kind === 'text'
                    ? {
                        ...currentBlock,
                        interaction: {
                          ...currentBlock.interaction,
                          prompt: { ...currentBlock.interaction.prompt, html: `${content}` }
                        }
                      }
                    : currentBlock
                )}
            />
            {#if textPromptError}
              <Field.Error id={getBlockDomId(block.id, 'prompt-error')}>{textPromptError}</Field.Error>
            {/if}
          </div>
          <InputField
            bind:value={block.interaction.maxScore}
            name={getBlockDomId(block.id, 'points')}
            label={$t('course.navItem.lessons.exercises.new_exercise_modal.points')}
            type="number"
            min="0"
            step="0.01"
            errorMessage={getValidationError(['blocks', blockIndex, 'interaction', 'maxScore'])}
            oninput={clearValidationState}
          />
        {/if}
      </div>
    {/each}

    <Button type="button" onclick={save} disabled={isSaving} loading={isSaving}>
      {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.save')}
    </Button>

    {#if composer.definition.blocks.length > 0}
      <div class="space-y-3 border-t pt-4">
        <p class="ui:text-muted-foreground text-sm">
          {$t('course.navItem.lessons.exercises.all_exercises.preview')}
        </p>
        <AssessmentItemRenderer definition={toAssessmentDeliveryDefinition(composer.definition)} disabled />
      </div>
    {/if}
  {/if}
</section>
