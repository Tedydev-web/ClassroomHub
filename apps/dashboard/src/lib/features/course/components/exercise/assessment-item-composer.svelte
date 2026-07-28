<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { RichTextField, TextEditor } from '$features/ui';
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
  import * as RadioGroup from '@cio/ui/base/radio-group';
  import * as Select from '@cio/ui/base/select';
  import type { TiptapEditor } from '@cio/ui/custom/editor';
  import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
  import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
  import BookOpenTextIcon from '@lucide/svelte/icons/book-open-text';
  import CheckIcon from '@lucide/svelte/icons/check';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import EyeIcon from '@lucide/svelte/icons/eye';
  import ListChecksIcon from '@lucide/svelte/icons/list-checks';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import TrashIcon from '@lucide/svelte/icons/trash';
  import Undo2Icon from '@lucide/svelte/icons/undo-2';
  import {
    MAX_ASSESSMENT_INTERACTIONS,
    MAX_INTERACTION_OPTIONS,
    deriveItemCapabilities,
    groupAssessmentBlocksByPassage,
    getItemMaxScore,
    parseAssessmentItemDefinition,
    toAssessmentDeliveryDefinition,
    validateAssessmentItemForPublish,
    type AssessmentBlock,
    type AssessmentContentBlock,
    type AssessmentGradingMode,
    type AssessmentInteractionBlock,
    type AssessmentIssue,
    type AssessmentItemDefinition
  } from '@cio/question-types';
  import {
    addChoiceInteractionBlock,
    addContentBlock,
    addTextInteractionBlock,
    addTrueFalseGroupInteractionBlock,
    addTrueFalseGroupStatement,
    createAssessmentComposerState,
    getAssessmentComposerSnapshot,
    initializeAssessmentPassageLayout,
    moveAssessmentInteractionWithinPassage,
    moveAssessmentPassageGroup,
    reconcileAssessmentComposerSave,
    removeAssessmentBlocks,
    removeTrueFalseGroupStatement,
    reorderAssessmentBlock,
    restoreAssessmentBlocks,
    setAssessmentItemPresentationLayout,
    setChoiceCorrectOption,
    setChoiceInteractionCardinality,
    setTrueFalseGroupScoringMode,
    type AssessmentComposerState
  } from '$features/course/utils/assessment-composer-state';
  import {
    removeAssessmentComposerPreviewItem,
    registerAssessmentComposerMutationHandler,
    registerAssessmentComposerSaveHandler,
    setAssessmentComposerDirty,
    setAssessmentComposerPreviewItem,
    setAssessmentComposerWide
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

  type AssessmentWorkspacePanel = 'passage' | 'questions' | 'preview';

  interface AssessmentTextEditorRegistration {
    blockId: string;
    editor: TiptapEditor;
    field: 'content' | 'prompt';
    label: string;
  }

  interface RemovedAssessmentBlocks {
    blocks: AssessmentBlock[];
    blockIndex: number;
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
  let mobileWorkspacePanel = $state<AssessmentWorkspacePanel>('passage');
  let activePassageGroupId = $state<string | null>(null);
  let showPreview = $state(false);
  let lastRemovedBlock = $state<RemovedAssessmentBlocks | null>(null);
  let pendingValidationFocusId: string | null = null;
  let pendingAtomicSave: {
    submittedSnapshot: string;
    submittedTitle: string;
  } | null = null;
  const textEditors = new SvelteMap<string, AssessmentTextEditorRegistration>();
  const composerInstanceId = $props.id();
  const composerRegistrationId = $derived(`${exerciseId}:${activeQuestionId ?? composerInstanceId}`);
  const usesPassageLayout = $derived(composer.definition.presentation?.layout === 'passage_split');
  const passageBlocks = $derived(
    composer.definition.blocks.filter((block): block is AssessmentContentBlock => block.kind === 'content')
  );
  const questionBlocks = $derived(
    composer.definition.blocks.filter((block): block is AssessmentInteractionBlock => block.kind === 'interaction')
  );
  const passageGroups = $derived(groupAssessmentBlocksByPassage(composer.definition.blocks));
  const passageGroupsWithContent = $derived(passageGroups.filter((group) => group.passage !== null));
  const activePassageGroup = $derived.by(
    () =>
      passageGroupsWithContent.find((group) => group.id === activePassageGroupId) ?? passageGroupsWithContent[0] ?? null
  );
  const activePassageIndex = $derived(
    activePassageGroup ? passageGroupsWithContent.findIndex((group) => group.id === activePassageGroup.id) : -1
  );
  const activePassageQuestionBlocks = $derived(activePassageGroup?.interactions ?? []);
  const activeQuestionBlock = $derived.by(() => {
    const availableQuestions = usesPassageLayout ? activePassageQuestionBlocks : questionBlocks;
    const selectedQuestion = availableQuestions.find((block) => block.id === composer.selectedBlockId);

    return selectedQuestion ?? availableQuestions[0] ?? null;
  });
  const activeQuestionIndex = $derived(
    activeQuestionBlock ? questionBlocks.findIndex((block) => block.id === activeQuestionBlock.id) : -1
  );
  const interactionLimitReached = $derived(questionBlocks.length >= MAX_ASSESSMENT_INTERACTIONS);
  const passageValidationError = $derived(
    validationIssues.some((issue) => issuePathEquals(issue, ['presentation', 'layout']))
      ? t.get('validations.generic.required_field')
      : ''
  );

  function getDraftSnapshot(): string {
    return getAssessmentComposerSnapshot(title, composer.definition);
  }

  const isDirty = $derived(!isLoading && getDraftSnapshot() !== persistedSnapshot);

  $effect(() => {
    setAssessmentComposerDirty(composerRegistrationId, isDirty);
  });

  $effect(() => {
    setAssessmentComposerWide(composerRegistrationId, usesPassageLayout);

    return () => setAssessmentComposerWide(composerRegistrationId, false);
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

    return t.get(required ? 'validations.generic.required_field' : 'validations.generic.invalid_field');
  }

  function getExactValidationError(path: Array<string | number>): string {
    if (!validationIssues.some((issue) => issuePathEquals(issue, path))) return '';

    return t.get('validations.generic.invalid_field');
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

  function syncTextEditorAccessibility(targetId: string, registration: AssessmentTextEditorRegistration) {
    if (registration.editor.isDestroyed) return;

    const blockIndex = composer.definition.blocks.findIndex((block) => block.id === registration.blockId);
    const error =
      registration.field === 'content'
        ? passageValidationError
        : blockIndex >= 0
          ? getValidationError(['blocks', blockIndex, 'interaction', 'prompt'], true)
          : '';
    const editorElement = registration.editor.view.dom;
    setTextEditorLabel(registration.editor, registration.label);

    if (error) {
      editorElement.setAttribute('aria-invalid', 'true');
      editorElement.setAttribute('aria-describedby', `${targetId}-error`);
      return;
    }

    editorElement.removeAttribute('aria-invalid');
    editorElement.removeAttribute('aria-describedby');
  }

  function registerTextEditor(
    targetId: string,
    blockId: string,
    field: AssessmentTextEditorRegistration['field'],
    label: string,
    editor: TiptapEditor
  ) {
    const registration = { blockId, editor, field, label };
    textEditors.set(targetId, registration);
    syncTextEditorAccessibility(targetId, registration);

    if (pendingValidationFocusId !== targetId) return;

    requestAnimationFrame(() => {
      if (registration.editor.isDestroyed || pendingValidationFocusId !== targetId) return;

      registration.editor.commands.focus();
      pendingValidationFocusId = null;
    });
  }

  function unregisterTextEditor(targetId: string) {
    textEditors.delete(targetId);
  }

  function getValidationFocusId(issue: AssessmentIssue): string {
    if (issuePathEquals(issue, ['presentation', 'layout'])) {
      const firstPassageBlock = passageBlocks[0];

      return firstPassageBlock ? getBlockDomId(firstPassageBlock.id, 'content') : `${getComposerDomId()}-add-content`;
    }

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

    if (block.kind === 'interaction' && block.interaction.kind === 'true_false_group') {
      const statementsPathIndex = issue.path.indexOf('statements');
      const statementIndex = statementsPathIndex >= 0 ? issue.path[statementsPathIndex + 1] : null;
      if (typeof statementIndex === 'number') {
        const statement = block.interaction.config.statements[statementIndex];
        if (statement) return getBlockDomId(statement.id, 'label');
      }

      const tiersPathIndex = issue.path.indexOf('tiers');
      const tierIndex = tiersPathIndex >= 0 ? issue.path[tiersPathIndex + 1] : null;
      if (typeof tierIndex === 'number') return getBlockDomId(block.id, `tier-${tierIndex}`);
      if (tiersPathIndex >= 0) return getBlockDomId(block.id, 'tier-0');
    }

    return getBlockDomId(block.id, 'block');
  }

  function revealValidationIssue(issue: AssessmentIssue) {
    showPreview = false;
    if (issuePathEquals(issue, ['presentation', 'layout'])) {
      mobileWorkspacePanel = 'passage';
      return;
    }

    const blockIndex = issue.path[0] === 'blocks' && typeof issue.path[1] === 'number' ? issue.path[1] : null;
    const block = blockIndex === null ? null : composer.definition.blocks[blockIndex];
    if (!block) return;

    mobileWorkspacePanel = block.kind === 'content' ? 'passage' : 'questions';
    const passageGroup = passageGroups.find(
      (group) => group.passage?.id === block.id || group.interactions.some((interaction) => interaction.id === block.id)
    );
    if (passageGroup?.passage) activePassageGroupId = passageGroup.id;
    composer = { ...composer, selectedBlockId: block.id };
  }

  function focusValidationTarget(targetId: string) {
    pendingValidationFocusId = targetId;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const registration = textEditors.get(targetId);
        if (registration && !registration.editor.isDestroyed) {
          registration.editor.commands.focus();
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

    for (const [targetId, registration] of textEditors) {
      syncTextEditorAccessibility(targetId, registration);
    }
  });

  function validateDraft(): AssessmentItemDefinition | null {
    clearValidationState();

    if (title.trim() === '') {
      titleError = t.get('validations.generic.required_field');
      snackbar.error(titleError);
      showPreview = false;
      focusValidationTarget(`${getComposerDomId()}-title`);
      return null;
    }

    const parsedDefinition = parseAssessmentItemDefinition(composer.definition);
    if (!parsedDefinition.success) {
      validationIssues = parsedDefinition.issues;
      snackbar.error(t.get('validations.generic.invalid_field'));
      const firstIssue = parsedDefinition.issues[0];
      if (firstIssue) {
        revealValidationIssue(firstIssue);
        focusValidationTarget(getValidationFocusId(firstIssue));
      }
      return null;
    }

    const publishable = validateAssessmentItemForPublish(parsedDefinition.data);
    if (!publishable.success) {
      validationIssues = publishable.issues;
      snackbar.error(t.get('validations.generic.invalid_field'));
      const firstIssue = publishable.issues[0];
      if (firstIssue) {
        revealValidationIssue(firstIssue);
        focusValidationTarget(getValidationFocusId(firstIssue));
      }
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
    lastRemovedBlock = null;
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

    showPreview = false;
    lastRemovedBlock = null;
    if (value === 'passage_split') {
      mobileWorkspacePanel = 'passage';
      updateComposer(initializeAssessmentPassageLayout(composer, createId));
      return;
    }

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
    if (usesPassageLayout) {
      const block = composer.definition.blocks.find((candidate) => candidate.id === blockId);
      if (!block) return;

      updateComposer(
        block.kind === 'content'
          ? moveAssessmentPassageGroup(composer, blockId, offset)
          : moveAssessmentInteractionWithinPassage(composer, blockId, offset)
      );
      return;
    }

    const sourceIndex = composer.definition.blocks.findIndex((block) => block.id === blockId);
    if (sourceIndex < 0) return;

    updateComposer(reorderAssessmentBlock(composer, blockId, sourceIndex + offset));
  }

  function canMoveBlock(blockId: string, offset: -1 | 1): boolean {
    const block = composer.definition.blocks.find((candidate) => candidate.id === blockId);
    if (!block) return false;

    if (usesPassageLayout && block.kind === 'content') {
      const passageIndex = passageGroupsWithContent.findIndex((group) => group.passage?.id === blockId);
      const destinationIndex = passageIndex + offset;

      return passageIndex >= 0 && destinationIndex >= 0 && destinationIndex < passageGroupsWithContent.length;
    }

    if (usesPassageLayout) {
      const passageGroup = passageGroups.find((group) =>
        group.interactions.some((interaction) => interaction.id === blockId)
      );
      const interactionIndex = passageGroup?.interactions.findIndex((interaction) => interaction.id === blockId) ?? -1;
      const destinationIndex = interactionIndex + offset;

      return (
        interactionIndex >= 0 && destinationIndex >= 0 && destinationIndex < (passageGroup?.interactions.length ?? 0)
      );
    }

    const laneBlocks = composer.definition.blocks;
    const laneIndex = laneBlocks.findIndex((candidate) => candidate.id === blockId);
    const destinationIndex = laneIndex + offset;

    return destinationIndex >= 0 && destinationIndex < laneBlocks.length;
  }

  function addPassageBlock() {
    mobileWorkspacePanel = 'passage';
    showPreview = false;
    const nextComposer = addContentBlock(composer, createId);
    updateComposer(nextComposer);
    activePassageGroupId = nextComposer.selectedBlockId;
  }

  function addChoiceQuestion() {
    if (interactionLimitReached) return;

    mobileWorkspacePanel = 'questions';
    showPreview = false;
    updateComposer(addChoiceInteractionBlock(composer, createId, activePassageGroup?.passage?.id));
  }

  function addTextQuestion() {
    if (interactionLimitReached) return;

    mobileWorkspacePanel = 'questions';
    showPreview = false;
    updateComposer(addTextInteractionBlock(composer, createId, activePassageGroup?.passage?.id));
  }

  function addTrueFalseGroupQuestion() {
    if (interactionLimitReached) return;

    mobileWorkspacePanel = 'questions';
    showPreview = false;
    updateComposer(addTrueFalseGroupInteractionBlock(composer, createId, activePassageGroup?.passage?.id));
  }

  function selectPassage(groupId: string) {
    const passageGroup = passageGroupsWithContent.find((group) => group.id === groupId);
    if (!passageGroup) return;

    showPreview = false;
    activePassageGroupId = groupId;
    composer = {
      ...composer,
      selectedBlockId: passageGroup.interactions[0]?.id ?? passageGroup.passage?.id ?? null
    };
  }

  function selectQuestion(blockId: string) {
    const passageGroup = passageGroups.find((group) =>
      group.interactions.some((interaction) => interaction.id === blockId)
    );
    if (passageGroup?.passage) activePassageGroupId = passageGroup.id;

    showPreview = false;
    mobileWorkspacePanel = 'questions';
    composer = { ...composer, selectedBlockId: blockId };
  }

  function setWorkspacePanel(panel: AssessmentWorkspacePanel) {
    mobileWorkspacePanel = panel;
    showPreview = panel === 'preview';
  }

  function togglePreview() {
    if (showPreview) {
      showPreview = false;
      mobileWorkspacePanel = activeQuestionBlock ? 'questions' : 'passage';
      return;
    }

    showPreview = true;
    mobileWorkspacePanel = 'preview';
  }

  function getBlockValidationIssueCount(blockIndex: number): number {
    return validationIssues.filter((issue) => issue.path[0] === 'blocks' && issue.path[1] === blockIndex).length;
  }

  function getQuestionTypeLabel(block: AssessmentInteractionBlock): string {
    if (block.interaction.kind === 'choice') {
      return t.get('course.navItem.lessons.exercises.all_exercises.assessment_item.choice');
    }
    if (block.interaction.kind === 'text') {
      return t.get('course.navItem.lessons.exercises.all_exercises.assessment_item.extended_text');
    }
    if (block.interaction.kind === 'true_false_group') {
      return t.get('course.navItem.lessons.exercises.all_exercises.assessment_item.true_false_group');
    }

    return t.get('course.navItem.lessons.exercises.all_exercises.assessment_item.question');
  }

  function getQuestionNumber(blockId: string): number {
    const questionIndex = questionBlocks.findIndex((block) => block.id === blockId);

    return questionIndex >= 0 ? questionIndex + 1 : 0;
  }

  function addChoiceOption(blockId: string) {
    updateBlock(blockId, (block) => {
      if (block.kind !== 'interaction' || block.interaction.kind !== 'choice') return block;
      if (block.interaction.config.options.length >= MAX_INTERACTION_OPTIONS) return block;

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

  function updateTrueFalseGroupScoringMode(blockId: string, value: string) {
    if (value !== 'tiered' && value !== 'proportional' && value !== 'all_or_nothing') return;

    updateComposer(setTrueFalseGroupScoringMode(composer, blockId, value));
  }

  function removeBlock(blockId: string) {
    const blockIndex = composer.definition.blocks.findIndex((block) => block.id === blockId);
    const block = composer.definition.blocks[blockIndex];
    if (!block) return;

    const passageGroup =
      usesPassageLayout && block.kind === 'content'
        ? passageGroups.find((group) => group.passage?.id === blockId)
        : undefined;
    const removedBlocks = passageGroup?.passage ? [passageGroup.passage, ...passageGroup.interactions] : [block];
    for (const removedBlock of removedBlocks) {
      textEditors.delete(getBlockDomId(removedBlock.id, 'prompt'));
      textEditors.delete(getBlockDomId(removedBlock.id, 'content'));
    }

    lastRemovedBlock = { blocks: removedBlocks, blockIndex };
    updateComposer(
      removeAssessmentBlocks(
        composer,
        removedBlocks.map((removedBlock) => removedBlock.id)
      )
    );
  }

  function undoRemoveBlock() {
    if (!lastRemovedBlock) return;

    updateComposer(restoreAssessmentBlocks(composer, lastRemovedBlock.blocks, lastRemovedBlock.blockIndex));
    const restoredPassage = lastRemovedBlock.blocks.find(
      (block): block is AssessmentContentBlock => block.kind === 'content'
    );
    if (restoredPassage) activePassageGroupId = restoredPassage.id;
    lastRemovedBlock = null;
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
      if (!result.data.authorDefinition) {
        console.error(`Assessment item "${questionId}" was loaded without author access`);
        snackbar.error();
        return;
      }

      title = result.data.title;
      composer = { definition: result.data.authorDefinition, selectedBlockId: null };
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

{#snippet layoutField()}
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
{/snippet}

{#snippet blockControls(block: AssessmentBlock)}
  <div class="flex items-center justify-end gap-1">
    <IconButton
      variant="secondary"
      disabled={!canMoveBlock(block.id, -1)}
      onclick={() => moveBlock(block.id, -1)}
      tooltip={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.move_up')}
      aria-label={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.move_up')}
    >
      <ArrowUpIcon class="h-4 w-4" />
    </IconButton>
    <IconButton
      variant="secondary"
      disabled={!canMoveBlock(block.id, 1)}
      onclick={() => moveBlock(block.id, 1)}
      tooltip={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.move_down')}
      aria-label={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.move_down')}
    >
      <ArrowDownIcon class="h-4 w-4" />
    </IconButton>
    <IconButton
      variant="secondary"
      onclick={() => removeBlock(block.id)}
      tooltip={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.remove')}
      aria-label={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.remove')}
    >
      <TrashIcon class="h-4 w-4" />
    </IconButton>
  </div>
{/snippet}

{#snippet contentEditor(block: AssessmentContentBlock)}
  {@const contentEditorId = getBlockDomId(block.id, 'content')}
  <div
    id={contentEditorId}
    role="group"
    aria-label={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.content_placeholder')}
    aria-describedby={passageValidationError ? `${contentEditorId}-error` : undefined}
    tabindex="-1"
  >
    <TextEditor
      content={block.content.html}
      editorClass={usesPassageLayout ? 'ui:h-auto ui:min-h-96 ui:overflow-visible' : ''}
      placeholder={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.content_placeholder')}
      onReady={(editor) =>
        registerTextEditor(
          contentEditorId,
          block.id,
          'content',
          t.get('course.navItem.lessons.exercises.all_exercises.assessment_item.content_placeholder'),
          editor
        )}
      onEditorDestroy={() => unregisterTextEditor(contentEditorId)}
      onChange={(content) =>
        updateBlock(block.id, (currentBlock) =>
          currentBlock.kind === 'content'
            ? { ...currentBlock, content: { ...currentBlock.content, html: `${content}` } }
            : currentBlock
        )}
    />
    {#if passageValidationError}
      <Field.Error id={`${contentEditorId}-error`}>{passageValidationError}</Field.Error>
    {/if}
  </div>
{/snippet}

{#snippet choiceInteractionEditor(block: AssessmentInteractionBlock, blockIndex: number)}
  {#if block.interaction.kind === 'choice'}
    <!-- `prompt.html` is HTML by contract and is delivered through `{@html}`,
         so it is authored with the editor rather than a plain input. -->
    <RichTextField
      bind:value={block.interaction.prompt.html}
      name={getBlockDomId(block.id, 'prompt')}
      label={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.prompt')}
      errorMessage={getValidationError(['blocks', blockIndex, 'interaction', 'prompt'], true)}
      oninput={clearValidationState}
    />
    {#if usesPassageLayout}
      <Field.Set>
        <Field.Legend>
          {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.response_settings')}
        </Field.Legend>
        <Field.Group>
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
          <Field.Field orientation="horizontal">
            <Checkbox
              id={getBlockDomId(block.id, 'multiple')}
              checked={block.interaction.config.cardinality === 'multiple'}
              onCheckedChange={(checked) =>
                updateComposer(
                  setChoiceInteractionCardinality(composer, block.id, checked === true ? 'multiple' : 'single')
                )}
            />
            <Field.Label for={getBlockDomId(block.id, 'multiple')} class="cursor-pointer font-normal">
              {$t('course.navItem.lessons.exercises.all_exercises.edit_mode.question_types.multiple')}
            </Field.Label>
          </Field.Field>
        </Field.Group>
      </Field.Set>
    {:else}
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
    {/if}
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
          <RichTextField
            bind:value={option.html}
            name={getBlockDomId(option.id, 'label')}
            className="min-w-0 flex-1"
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
            aria-label={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.remove')}
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
      disabled={block.interaction.config.options.length >= MAX_INTERACTION_OPTIONS}
      aria-describedby={optionsError ? getBlockDomId(block.id, 'options-error') : undefined}
      onclick={() => addChoiceOption(block.id)}
    >
      <PlusIcon class="h-4 w-4" />
      {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.add_option')}
    </Button>
  {/if}
{/snippet}

{#snippet textInteractionEditor(block: AssessmentInteractionBlock, blockIndex: number)}
  {#if block.interaction.kind === 'text'}
    {@const promptEditorId = getBlockDomId(block.id, 'prompt')}
    {@const textPromptError = getValidationError(['blocks', blockIndex, 'interaction', 'prompt'], true)}
    <div
      id={promptEditorId}
      role="group"
      aria-label={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.prompt')}
      aria-describedby={textPromptError ? getBlockDomId(block.id, 'prompt-error') : undefined}
      data-assessment-text-prompt={block.id}
      tabindex="-1"
    >
      <TextEditor
        content={block.interaction.prompt.html}
        editorClass={usesPassageLayout ? 'ui:min-h-48' : ''}
        placeholder={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.prompt')}
        onReady={(editor) =>
          registerTextEditor(
            promptEditorId,
            block.id,
            'prompt',
            t.get('course.navItem.lessons.exercises.all_exercises.assessment_item.prompt'),
            editor
          )}
        onEditorDestroy={() => unregisterTextEditor(promptEditorId)}
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
    {#if usesPassageLayout}
      <Field.Set>
        <Field.Legend>
          {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.response_settings')}
        </Field.Legend>
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
      </Field.Set>
    {:else}
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
  {/if}
{/snippet}

{#snippet trueFalseGroupInteractionEditor(block: AssessmentInteractionBlock, blockIndex: number)}
  {#if block.interaction.kind === 'true_false_group'}
    <RichTextField
      bind:value={block.interaction.prompt.html}
      name={getBlockDomId(block.id, 'prompt')}
      label={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.prompt')}
      errorMessage={getValidationError(['blocks', blockIndex, 'interaction', 'prompt'], true)}
      oninput={clearValidationState}
    />

    <Field.Set>
      <Field.Legend>
        {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.response_settings')}
      </Field.Legend>
      <Field.Group>
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
        <Field.Field>
          <Field.Label for={getBlockDomId(block.id, 'scoring-mode')}>
            {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.scoring_mode')}
          </Field.Label>
          <Select.Root
            type="single"
            value={block.interaction.config.scoring.mode}
            onValueChange={(value) => updateTrueFalseGroupScoringMode(block.id, value)}
          >
            <Select.Trigger id={getBlockDomId(block.id, 'scoring-mode')} class="w-full">
              {#if block.interaction.config.scoring.mode === 'tiered'}
                {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.scoring_tiered')}
              {:else if block.interaction.config.scoring.mode === 'proportional'}
                {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.scoring_proportional')}
              {:else}
                {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.scoring_all_or_nothing')}
              {/if}
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="tiered">
                {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.scoring_tiered')}
              </Select.Item>
              <Select.Item value="proportional">
                {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.scoring_proportional')}
              </Select.Item>
              <Select.Item value="all_or_nothing">
                {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.scoring_all_or_nothing')}
              </Select.Item>
            </Select.Content>
          </Select.Root>
        </Field.Field>
      </Field.Group>
    </Field.Set>

    <Field.Set>
      <Field.Legend>
        {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.true_false_group')}
      </Field.Legend>
      <Field.Group>
        {#each block.interaction.config.statements as statement, statementIndex (statement.id)}
          {@const correctValueLabelId = getBlockDomId(statement.id, 'correct-label')}
          <Field.Field>
            <div class="flex items-start gap-2">
              <RichTextField
                bind:value={statement.html}
                name={getBlockDomId(statement.id, 'label')}
                className="min-w-0 flex-1"
                label={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.statement', {
                  index: statementIndex + 1
                })}
                errorMessage={getValidationError(
                  ['blocks', blockIndex, 'interaction', 'config', 'statements', statementIndex, 'html'],
                  true
                )}
                oninput={clearValidationState}
              />
              <IconButton
                variant="secondary"
                disabled={block.interaction.config.statements.length <= 2}
                onclick={() => updateComposer(removeTrueFalseGroupStatement(composer, block.id, statement.id))}
                tooltip={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.remove')}
                aria-label={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.remove')}
              >
                <TrashIcon class="h-4 w-4" />
              </IconButton>
            </div>
            <div class="space-y-2">
              <p id={correctValueLabelId} class="text-sm font-medium">
                {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.correct_value')}
              </p>
              <RadioGroup.Root
                value={String(statement.correctValue)}
                aria-labelledby={correctValueLabelId}
                onValueChange={(value) => {
                  statement.correctValue = value === 'true';
                  clearValidationState();
                }}
              >
                <div class="flex flex-wrap gap-4">
                  <div class="flex items-center gap-2">
                    <RadioGroup.Item id={getBlockDomId(statement.id, 'true')} value="true" />
                    <Label for={getBlockDomId(statement.id, 'true')} class="cursor-pointer font-normal">
                      {$t('course.navItem.lessons.exercises.all_exercises.shared_question.true_false.true_label')}
                    </Label>
                  </div>
                  <div class="flex items-center gap-2">
                    <RadioGroup.Item id={getBlockDomId(statement.id, 'false')} value="false" />
                    <Label for={getBlockDomId(statement.id, 'false')} class="cursor-pointer font-normal">
                      {$t('course.navItem.lessons.exercises.all_exercises.shared_question.true_false.false_label')}
                    </Label>
                  </div>
                </div>
              </RadioGroup.Root>
            </div>
          </Field.Field>
        {/each}
      </Field.Group>
      <Button
        id={getBlockDomId(block.id, 'add-statement')}
        type="button"
        variant="secondary"
        size="sm"
        disabled={block.interaction.config.statements.length >= MAX_INTERACTION_OPTIONS}
        onclick={() => updateComposer(addTrueFalseGroupStatement(composer, block.id, createId))}
      >
        <PlusIcon class="h-4 w-4" />
        {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.add_statement')}
      </Button>
    </Field.Set>

    {#if block.interaction.config.scoring.mode === 'tiered'}
      <Field.Set>
        <Field.Legend>
          {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.scoring_tiered')}
        </Field.Legend>
        <Field.Group class="grid gap-4 sm:grid-cols-2">
          {#each block.interaction.config.scoring.tiers as _tier, correctCount (correctCount)}
            <InputField
              bind:value={block.interaction.config.scoring.tiers[correctCount]}
              name={getBlockDomId(block.id, `tier-${correctCount}`)}
              label={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.tier_for_correct', {
                correct: correctCount,
                total: block.interaction.config.statements.length
              })}
              type="number"
              min="0"
              max="1"
              step="0.01"
              errorMessage={getValidationError(['blocks', blockIndex, 'interaction', 'config', 'scoring', 'tiers'])}
              oninput={clearValidationState}
            />
          {/each}
        </Field.Group>
      </Field.Set>
    {/if}
  {/if}
{/snippet}

{#snippet interactionEditor(block: AssessmentInteractionBlock, blockIndex: number)}
  {@render choiceInteractionEditor(block, blockIndex)}
  {@render textInteractionEditor(block, blockIndex)}
  {@render trueFalseGroupInteractionEditor(block, blockIndex)}
{/snippet}

{#if usesPassageLayout}
  <section class="ui:border-border ui:bg-background overflow-hidden rounded-md border">
    <div class="ui:border-border ui:bg-background space-y-4 border-b p-4">
      <div class="grid items-end gap-4 xl:grid-cols-[minmax(18rem,1fr)_minmax(15rem,20rem)_auto]">
        <RichTextField
          bind:value={title}
          name={`${getComposerDomId()}-title`}
          label={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.title')}
          placeholder={$t('course.navItem.lessons.exercises.all_exercises.write_your_question_here')}
          errorMessage={titleError}
          oninput={clearValidationState}
        />
        {@render layoutField()}
        <div id={`${getComposerDomId()}-actions`} class="flex flex-wrap items-center justify-end gap-2" tabindex="-1">
          <div class="ui:text-muted-foreground flex min-h-11 items-center gap-2 px-2 text-sm" aria-live="polite">
            {#if isDirty}
              <CircleAlertIcon class="ui:text-amber-600 h-4 w-4" aria-hidden="true" />
              {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.save_status_unsaved')}
            {:else if activeQuestionId === undefined}
              <CircleAlertIcon class="ui:text-muted-foreground h-4 w-4" aria-hidden="true" />
              {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.save_status_draft')}
            {:else}
              <CheckIcon class="ui:text-emerald-600 h-4 w-4" aria-hidden="true" />
              {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.save_status_saved')}
            {/if}
          </div>
          <Button type="button" variant="secondary" class="min-h-11" onclick={togglePreview}>
            <EyeIcon class="h-4 w-4" />
            {showPreview
              ? $t('course.navItem.lessons.exercises.all_exercises.assessment_item.return_to_editor')
              : $t('course.navItem.lessons.exercises.all_exercises.preview')}
          </Button>
          <Button type="button" class="min-h-11" onclick={save} disabled={isSaving} loading={isSaving}>
            {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.save')}
          </Button>
        </div>
      </div>

      <div
        class="ui:bg-muted/50 grid grid-cols-3 gap-1 rounded-md p-1 xl:hidden"
        aria-label={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.workspace')}
      >
        <Button
          type="button"
          variant={mobileWorkspacePanel === 'passage' ? 'secondary' : 'ghost'}
          class="min-h-14 flex-col gap-1 px-1 text-xs sm:px-2 sm:text-sm"
          aria-pressed={mobileWorkspacePanel === 'passage'}
          onclick={() => setWorkspacePanel('passage')}
        >
          <BookOpenTextIcon class="h-4 w-4" />
          {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.passage')}
        </Button>
        <Button
          type="button"
          variant={mobileWorkspacePanel === 'questions' ? 'secondary' : 'ghost'}
          class="min-h-14 flex-col gap-1 px-1 text-xs sm:px-2 sm:text-sm"
          aria-pressed={mobileWorkspacePanel === 'questions'}
          onclick={() => setWorkspacePanel('questions')}
        >
          <ListChecksIcon class="h-4 w-4" />
          {$t('course.navItem.lessons.exercises.all_exercises.questions')}
        </Button>
        <Button
          type="button"
          variant={mobileWorkspacePanel === 'preview' ? 'secondary' : 'ghost'}
          class="min-h-14 flex-col gap-1 px-1 text-xs sm:px-2 sm:text-sm"
          aria-pressed={mobileWorkspacePanel === 'preview'}
          onclick={() => setWorkspacePanel('preview')}
        >
          <EyeIcon class="h-4 w-4" />
          {$t('course.navItem.lessons.exercises.all_exercises.preview')}
        </Button>
      </div>

      {#if validationIssues.length > 0}
        <div
          class="ui:border-destructive/40 ui:bg-destructive/5 ui:text-destructive flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
          role="alert"
        >
          <CircleAlertIcon class="h-4 w-4 shrink-0" aria-hidden="true" />
          {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.validation_summary', {
            count: validationIssues.length
          })}
        </div>
      {/if}

      {#if lastRemovedBlock}
        <div
          class="ui:border-border ui:bg-muted/40 flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
          aria-live="polite"
        >
          <span>
            {$t(
              lastRemovedBlock.blocks[0]?.kind === 'content'
                ? 'course.navItem.lessons.exercises.all_exercises.assessment_item.passage_removed'
                : 'course.navItem.lessons.exercises.all_exercises.assessment_item.question_removed'
            )}
          </span>
          <Button type="button" variant="secondary" size="sm" onclick={undoRemoveBlock}>
            <Undo2Icon class="h-4 w-4" />
            {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.undo')}
          </Button>
        </div>
      {/if}
    </div>

    {#if isLoading}
      <div class="space-y-4 p-4">
        <div class="ui:animate-pulse ui:h-12 ui:rounded ui:bg-muted"></div>
        <div class="grid gap-4 xl:grid-cols-[minmax(20rem,5fr)_minmax(28rem,7fr)]">
          <div class="ui:animate-pulse ui:h-128 ui:rounded ui:bg-muted"></div>
          <div class="ui:animate-pulse ui:h-128 ui:rounded ui:bg-muted"></div>
        </div>
      </div>
    {:else}
      <div
        class={showPreview
          ? 'hidden'
          : 'xl:grid xl:max-h-[calc(100dvh-12rem)] xl:min-h-[40rem] xl:grid-cols-[minmax(20rem,5fr)_minmax(28rem,7fr)]'}
      >
        <section
          class:hidden={mobileWorkspacePanel !== 'passage'}
          class="ui:border-border min-w-0 xl:block xl:overflow-y-auto xl:border-r"
          aria-labelledby={`${getComposerDomId()}-passage-heading`}
        >
          <header
            class="ui:border-border ui:bg-background sticky top-0 z-10 flex min-h-14 items-center justify-between gap-3 border-b px-4 py-2"
          >
            <div class="flex min-w-0 items-center gap-2">
              <BookOpenTextIcon class="ui:text-muted-foreground h-4 w-4 shrink-0" aria-hidden="true" />
              <h2 id={`${getComposerDomId()}-passage-heading`} class="truncate text-sm font-semibold">
                {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.passage')}
              </h2>
              <span class="ui:text-muted-foreground text-xs tabular-nums">{passageBlocks.length}</span>
            </div>
            <Button
              id={`${getComposerDomId()}-add-content`}
              type="button"
              variant="secondary"
              size="sm"
              class="min-h-11"
              onclick={addPassageBlock}
            >
              <PlusIcon class="h-4 w-4" />
              {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.add_content')}
            </Button>
          </header>
          <p class="ui:text-muted-foreground ui:border-border border-b px-4 py-3 text-sm">
            {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.passage_helper')}
          </p>

          {#if passageGroupsWithContent.length === 0}
            <div class="flex min-h-80 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
              <BookOpenTextIcon class="ui:text-muted-foreground h-8 w-8" aria-hidden="true" />
              <div class="max-w-sm space-y-1">
                <h3 class="text-sm font-semibold">
                  {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.empty_passage')}
                </h3>
                <p class="ui:text-muted-foreground text-sm">
                  {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.empty_passage_helper')}
                </p>
              </div>
              <Button type="button" variant="secondary" class="min-h-11" onclick={addPassageBlock}>
                <PlusIcon class="h-4 w-4" />
                {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.add_content')}
              </Button>
            </div>
          {:else}
            <nav
              class="ui:border-border ui:bg-muted/20 flex gap-2 overflow-x-auto border-b p-2"
              aria-label={$t(
                'course.navItem.lessons.exercises.all_exercises.assessment_item.passage_workspace_navigation'
              )}
            >
              {#each passageGroupsWithContent as passageGroup, passageIndex (passageGroup.id)}
                {@const firstQuestion = passageGroup.interactions[0]}
                {@const lastQuestion = passageGroup.interactions[passageGroup.interactions.length - 1]}
                <Button
                  type="button"
                  variant={activePassageGroup?.id === passageGroup.id ? 'secondary' : 'ghost'}
                  class="min-h-14 min-w-40 flex-col items-start gap-0.5 px-3 text-left"
                  aria-current={activePassageGroup?.id === passageGroup.id ? 'true' : undefined}
                  onclick={() => selectPassage(passageGroup.id)}
                >
                  <span class="text-sm font-medium">
                    {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.passage_workspace_passage', {
                      index: passageIndex + 1
                    })}
                  </span>
                  {#if firstQuestion && lastQuestion}
                    <span class="ui:text-muted-foreground text-xs font-normal">
                      {$t(
                        'course.navItem.lessons.exercises.all_exercises.assessment_item.passage_workspace_question_range',
                        {
                          start: getQuestionNumber(firstQuestion.id),
                          end: getQuestionNumber(lastQuestion.id)
                        }
                      )}
                    </span>
                  {/if}
                </Button>
              {/each}
            </nav>

            {#if activePassageGroup?.passage}
              <article id={getBlockDomId(activePassageGroup.passage.id, 'block')} class="space-y-4 p-4" tabindex="-1">
                <div class="flex items-center justify-between gap-3">
                  <p class="ui:text-muted-foreground text-xs font-medium">
                    {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.passage_part', {
                      index: activePassageIndex + 1
                    })}
                  </p>
                  {@render blockControls(activePassageGroup.passage)}
                </div>
                {@render contentEditor(activePassageGroup.passage)}
              </article>
            {/if}
          {/if}
        </section>

        <section
          class:hidden={mobileWorkspacePanel !== 'questions'}
          class="min-w-0 xl:block xl:min-h-0 xl:overflow-hidden"
          aria-labelledby={`${getComposerDomId()}-questions-heading`}
        >
          <header
            class="ui:border-border ui:bg-background flex min-h-14 flex-wrap items-center justify-between gap-3 border-b px-4 py-2"
          >
            <div class="flex min-w-0 items-center gap-2">
              <ListChecksIcon class="ui:text-muted-foreground h-4 w-4 shrink-0" aria-hidden="true" />
              <h2 id={`${getComposerDomId()}-questions-heading`} class="truncate text-sm font-semibold">
                {$t('course.navItem.lessons.exercises.all_exercises.questions')}
              </h2>
              <span class="ui:text-muted-foreground text-xs tabular-nums">
                {questionBlocks.length}/{MAX_ASSESSMENT_INTERACTIONS}
              </span>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                class="min-h-11"
                disabled={interactionLimitReached}
                onclick={addChoiceQuestion}
              >
                <PlusIcon class="h-4 w-4" />
                {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.choice')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                class="min-h-11"
                disabled={interactionLimitReached}
                onclick={addTextQuestion}
              >
                <PlusIcon class="h-4 w-4" />
                {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.extended_text')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                class="min-h-11"
                disabled={interactionLimitReached}
                onclick={addTrueFalseGroupQuestion}
              >
                <PlusIcon class="h-4 w-4" />
                {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.true_false_group')}
              </Button>
            </div>
          </header>

          <div
            class="min-h-0 xl:flex xl:h-[calc(100%-3.5rem)] xl:flex-col 2xl:grid 2xl:grid-cols-[14rem_minmax(0,1fr)]"
          >
            {#if activePassageQuestionBlocks.length > 0}
              <nav
                class="ui:border-border ui:bg-muted/20 flex shrink-0 gap-2 overflow-x-auto border-b p-2 2xl:block 2xl:space-y-1 2xl:overflow-y-auto 2xl:border-r 2xl:border-b-0"
                aria-label={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.question_outline')}
              >
                {#each activePassageQuestionBlocks as block (block.id)}
                  {@const blockIndex = composer.definition.blocks.findIndex((candidate) => candidate.id === block.id)}
                  {@const issueCount = getBlockValidationIssueCount(blockIndex)}
                  <Button
                    type="button"
                    variant={activeQuestionBlock?.id === block.id ? 'secondary' : 'ghost'}
                    class="min-h-14 min-w-44 justify-start px-3 text-left 2xl:w-full 2xl:min-w-0"
                    aria-current={activeQuestionBlock?.id === block.id ? 'true' : undefined}
                    onclick={() => selectQuestion(block.id)}
                  >
                    <span class="ui:text-muted-foreground w-6 shrink-0 text-xs tabular-nums">
                      {getQuestionNumber(block.id)}
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm font-medium">{getQuestionTypeLabel(block)}</span>
                      <span class="ui:text-muted-foreground block truncate text-xs">
                        {$t('course.navItem.lessons.exercises.new_exercise_modal.points')}: {block.interaction.maxScore}
                      </span>
                    </span>
                    {#if issueCount > 0}
                      <span
                        class="ui:bg-destructive ui:text-destructive-foreground inline-flex h-6 min-w-6 items-center justify-center rounded px-1 text-xs tabular-nums"
                        aria-label={$t(
                          'course.navItem.lessons.exercises.all_exercises.assessment_item.question_error_count',
                          { count: issueCount }
                        )}
                      >
                        {issueCount}
                      </span>
                    {/if}
                  </Button>
                {/each}
              </nav>
            {/if}

            <div class="min-h-0 min-w-0 flex-1 overflow-y-auto">
              {#if activeQuestionBlock && activeQuestionIndex >= 0}
                {@const blockIndex = composer.definition.blocks.findIndex(
                  (block) => block.id === activeQuestionBlock.id
                )}
                {@const issueCount = getBlockValidationIssueCount(blockIndex)}
                <article id={getBlockDomId(activeQuestionBlock.id, 'block')} class="space-y-6 p-4 sm:p-6" tabindex="-1">
                  <div class="ui:border-border flex flex-wrap items-start justify-between gap-4 border-b pb-4">
                    <div class="min-w-0 space-y-1">
                      <p class="ui:text-muted-foreground text-xs font-medium">
                        {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.question_number', {
                          index: activeQuestionIndex + 1
                        })}
                      </p>
                      <h3 class="text-base font-semibold">{getQuestionTypeLabel(activeQuestionBlock)}</h3>
                      {#if issueCount > 0}
                        <p class="ui:text-destructive flex items-center gap-2 text-sm" role="status">
                          <CircleAlertIcon class="h-4 w-4" aria-hidden="true" />
                          {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.question_error_count', {
                            count: issueCount
                          })}
                        </p>
                      {/if}
                    </div>
                    {@render blockControls(activeQuestionBlock)}
                  </div>
                  {@render interactionEditor(activeQuestionBlock, blockIndex)}
                </article>
              {:else}
                <div class="flex min-h-80 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
                  <ListChecksIcon class="ui:text-muted-foreground h-8 w-8" aria-hidden="true" />
                  <div class="max-w-sm space-y-1">
                    <h3 class="text-sm font-semibold">
                      {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.empty_questions')}
                    </h3>
                    <p class="ui:text-muted-foreground text-sm">
                      {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.empty_questions_helper')}
                    </p>
                  </div>
                  <div class="flex flex-wrap justify-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      class="min-h-11"
                      disabled={interactionLimitReached}
                      onclick={addChoiceQuestion}
                    >
                      <PlusIcon class="h-4 w-4" />
                      {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.choice')}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      class="min-h-11"
                      disabled={interactionLimitReached}
                      onclick={addTextQuestion}
                    >
                      <PlusIcon class="h-4 w-4" />
                      {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.extended_text')}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      class="min-h-11"
                      disabled={interactionLimitReached}
                      onclick={addTrueFalseGroupQuestion}
                    >
                      <PlusIcon class="h-4 w-4" />
                      {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.true_false_group')}
                    </Button>
                  </div>
                </div>
              {/if}
            </div>
          </div>
        </section>
      </div>

      <section
        class:hidden={!showPreview}
        class="min-h-[32rem] space-y-6 p-4 sm:p-6"
        aria-labelledby={`${getComposerDomId()}-preview-heading`}
      >
        <div class="ui:border-border flex items-center justify-between gap-3 border-b pb-4">
          <div>
            <h2 id={`${getComposerDomId()}-preview-heading`} class="text-base font-semibold">
              {$t('course.navItem.lessons.exercises.all_exercises.preview')}
            </h2>
          </div>
          <Button type="button" variant="secondary" class="min-h-11" onclick={togglePreview}>
            {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.return_to_editor')}
          </Button>
        </div>
        <AssessmentItemRenderer
          {title}
          definition={toAssessmentDeliveryDefinition(composer.definition)}
          disabled
          trueLabel={$t('course.navItem.lessons.exercises.all_exercises.shared_question.true_false.true_label')}
          falseLabel={$t('course.navItem.lessons.exercises.all_exercises.shared_question.true_false.false_label')}
        />
      </section>
    {/if}
  </section>
{:else}
  <section class="space-y-4 rounded-md border p-4">
    <RichTextField
      bind:value={title}
      name={`${getComposerDomId()}-title`}
      label={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.title')}
      placeholder={$t('course.navItem.lessons.exercises.all_exercises.write_your_question_here')}
      errorMessage={titleError}
      oninput={clearValidationState}
    />

    {@render layoutField()}

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
          disabled={interactionLimitReached}
          onclick={addChoiceQuestion}
        >
          <PlusIcon class="h-4 w-4" />
          {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.add_choice')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={interactionLimitReached}
          onclick={addTextQuestion}
        >
          <PlusIcon class="h-4 w-4" />
          {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.add_text')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={interactionLimitReached}
          onclick={addTrueFalseGroupQuestion}
        >
          <PlusIcon class="h-4 w-4" />
          {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.true_false_group')}
        </Button>
      </div>

      {#each composer.definition.blocks as block (block.id)}
        {@const blockIndex = composer.definition.blocks.findIndex((candidate) => candidate.id === block.id)}
        <div id={getBlockDomId(block.id, 'block')} class="space-y-4 rounded border p-4" tabindex="-1">
          {@render blockControls(block)}
          {#if block.kind === 'content'}
            {@render contentEditor(block)}
          {:else}
            {@render interactionEditor(block, blockIndex)}
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
          <AssessmentItemRenderer
            definition={toAssessmentDeliveryDefinition(composer.definition)}
            disabled
            trueLabel={$t('course.navItem.lessons.exercises.all_exercises.shared_question.true_false.true_label')}
            falseLabel={$t('course.navItem.lessons.exercises.all_exercises.shared_question.true_false.false_label')}
          />
        </div>
      {/if}
    {/if}
  </section>
{/if}
