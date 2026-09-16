<script lang="ts">
  import TrashIcon from '@lucide/svelte/icons/trash';
  import GripVerticalIcon from '@lucide/svelte/icons/grip-vertical';
  import InfoIcon from '@lucide/svelte/icons/info';
  import BookOpenTextIcon from '@lucide/svelte/icons/book-open-text';
  import ListChecksIcon from '@lucide/svelte/icons/list-checks';
  import Settings2Icon from '@lucide/svelte/icons/settings-2';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import { dndzone } from 'svelte-dnd-action';
  import { flip } from 'svelte/animate';
  import { tick } from 'svelte';

  import {
    questionnaire,
    deleteConfirmation,
    questionnaireValidation,
    handleRemoveQuestion,
    handleCode,
    handleAddQuestion,
    removeUntouchedLegacyQuestionDrafts,
    handleRemoveSection,
    handleReorderSections,
    handleReorderQuestionPlacementItems,
    handleUpdateSectionAfterBehavior,
    handleUpdateSectionColorTheme,
    handleUpdateSectionDescription,
    handleUpdateSectionTitle,
    hasSections,
    getQuestionPlacementItemsForSection,
    getQuestionsForSection,
    type CanonicalQuestionState,
    type ExerciseQuestionPlacementItem
  } from './store';
  import { QUESTION_TYPES } from '$features/ui/question/constants';
  import { ExerciseQuestion } from '@cio/ui';
  import { Badge } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import * as Tooltip from '@cio/ui/base/tooltip';

  import OrderModal from './order-modal.svelte';
  import QuestionTypeSelect from './question-type-select.svelte';
  import { t } from '$lib/utils/functions/translations';
  import { IconButton } from '@cio/ui/custom/icon-button';
  import { TextareaField } from '@cio/ui/custom/textarea-field';
  import { richTextToPlainText } from '@cio/ui/tools';
  import DeleteConfirmationModal from './delete-confirmation.svelte';
  import { QuestionContainer } from '$features/course/components';
  import { uploadImage } from '$lib/utils/services/upload';
  import {
    getExerciseEditorQuestionTypeLabel,
    getQuestionTypeKey,
    getQuestionTypeOptionById,
    questionTypeSupportsOptions,
    toExerciseQuestionModel
  } from './question-type-utils';
  import {
    QUESTION_TYPE_KEY,
    isAutoGradableQuestionTypeId,
    resolveTrueFalseCorrectValue,
    syncTrueFalseOptions
  } from '@cio/question-types';
  import { getExerciseQuestionLabels } from './question-labels';
  import SectionEditor from './section-editor.svelte';
  import type { Question } from '$features/course/types';
  import type { ExerciseEditorErrors } from './store';
  import { getResolvedUploadLimits } from '$lib/utils/config/upload-limits-context';
  import { courseApi } from '$features/course/api';
  import AssessmentItemComposer from './assessment-item-composer.svelte';
  import { countAssessmentQuestions, countSectionQuestions } from './assessment-item-summary';

  const flipDurationMs = 200;
  const uploadLimits = getResolvedUploadLimits();
  const platformMaxFileSizeMb = uploadLimits.exerciseFileMb;
  const initialQuestionsLength = $questionnaire.questions.length;
  type QuestionDndEvent = CustomEvent<{ items: ExerciseQuestionPlacementItem[] }>;
  type CanonicalQuestion = CanonicalQuestionState;

  interface Props {
    shouldDeleteExercise?: boolean;
    exerciseId: string;
    goBack?: () => void;
    /** All auto-gradable question types (any course): enforce points &gt; 0 for scoring */
    requiresPositivePointsForAutoGrade?: boolean;
    selfPacedCourse?: boolean;
    /** Public course restricts picker to auto-gradable question types only. */
    isPublicCourse?: boolean;
    reorderQuestions?: boolean;
    onSaveRequested: () => Promise<void>;
  }

  let {
    shouldDeleteExercise = $bindable(false),
    exerciseId: _exerciseId,
    goBack: _goBack = () => {},
    requiresPositivePointsForAutoGrade = false,
    selfPacedCourse = false,
    isPublicCourse = false,
    reorderQuestions = false,
    onSaveRequested
  }: Props = $props();

  const availableQuestionTypes = $derived(
    isPublicCourse ? QUESTION_TYPES.filter((type) => type.autoGradable) : QUESTION_TYPES
  );

  let questionIdToDelete = $state(null);
  let sectionIdToDelete = $state<string | null>(null);
  let deleteConfirmationType = $state<'question' | 'section'>('question');
  let reorderQuestionItemsBySectionId = $state<Record<string, ExerciseQuestionPlacementItem[]>>({});
  let previousReorderQuestions = $state(false);
  let newAssessmentComposerSectionId = $state<string | null | undefined>(undefined);
  let promotedAssessmentQuestionId = $state<number | null>(null);
  let activeCanonicalQuestionId = $state<number | null>(null);
  let pendingCanonicalQuestionId = $state<number | null>(null);
  let activeWorkspaceSectionId = $state<string | null>(null);
  let activeLegacyQuestionId = $state<string | number | null>(null);
  let workspaceEditorMode = $state<'question' | 'section'>('question');
  let workspacePanel = $state<'outline' | 'editor'>('outline');
  let errors = $derived($questionnaireValidation);
  const questionLabels = $derived(getExerciseQuestionLabels());
  const activeSections = $derived(
    [...($questionnaire.sections ?? [])].filter((section) => !section.deletedAt).sort((a, b) => a.order - b.order)
  );
  /**
   * Question authoring follows the upstream layout: every legacy question is edited
   * in place inside its section, with no separate outline-and-editor split.
   *
   * The two-pane workspace panel below is kept intact behind this switch so it can be
   * folded back in once the new authoring design is settled. Turning this on restores
   * the split view; assessment items keep opening their own composer either way.
   */
  const USE_ASSESSMENT_WORKSPACE_PANEL = false;

  const isAssessmentWorkspaceOpen = $derived(
    !reorderQuestions && (activeCanonicalQuestionId !== null || newAssessmentComposerSectionId !== undefined)
  );
  const sectionLabels = $derived({
    questions: t.get('course.navItem.lessons.exercises.all_exercises.section.questions'),
    shortQuestions: t.get('course.navItem.lessons.exercises.all_exercises.section.short_questions'),
    required: t.get('course.navItem.lessons.exercises.all_exercises.section.required'),
    addQuestion: t.get('course.navItem.lessons.exercises.all_exercises.section.add_question'),
    delete: t.get('course.navItem.lessons.exercises.all_exercises.section.delete'),
    moveUp: t.get('course.navItem.lessons.exercises.all_exercises.section.move_up'),
    moveDown: t.get('course.navItem.lessons.exercises.all_exercises.section.move_down'),
    color: t.get('course.navItem.lessons.exercises.all_exercises.section.color'),
    descriptionPlaceholder: t.get('course.navItem.lessons.exercises.all_exercises.section.description_placeholder'),
    collapseSection: t.get('course.navItem.lessons.exercises.all_exercises.section.collapse_section'),
    expandSection: t.get('course.navItem.lessons.exercises.all_exercises.section.expand_section')
  });
  const sectionAfterBehaviorLabels = $derived({
    afterSectionPrefix: t.get('course.navItem.lessons.exercises.all_exercises.section.after_section'),
    continue: t.get('course.navItem.lessons.exercises.all_exercises.section.continue'),
    goToSection: t.get('course.navItem.lessons.exercises.all_exercises.section.go_to_section'),
    submit: t.get('course.navItem.lessons.exercises.all_exercises.section.submit')
  });

  function shouldScrollToLast(questionId, questions) {
    const [lastQuestion] = questions.slice(-1);
    const currentQuestionsLength = questions.length;
    const isLast = lastQuestion.id === questionId;

    return isLast && initialQuestionsLength !== currentQuestionsLength;
  }

  async function scrollToExerciseElement(elementId: string) {
    await tick();
    requestAnimationFrame(() => {
      document.getElementById(elementId)?.scrollIntoView({
        block: 'start',
        behavior: 'smooth',
        inline: 'nearest'
      });
    });
  }

  function getQuestionElementId(questionId: string | number) {
    return `exercise-question-${questionId}`;
  }

  async function addQuestionToSection(sectionId: string | null) {
    const questionId = handleAddQuestion(sectionId);
    activeWorkspaceSectionId = sectionId;
    activeLegacyQuestionId = questionId;
    workspaceEditorMode = 'question';
    workspacePanel = 'editor';
    await scrollToExerciseElement(getQuestionElementId(questionId));
  }

  function selectWorkspaceSection(sectionId: string | null) {
    activeWorkspaceSectionId = sectionId;
    activeLegacyQuestionId = null;
    workspaceEditorMode = 'section';
    workspacePanel = 'editor';
  }

  function selectLegacyQuestion(question: Question) {
    activeWorkspaceSectionId = question.exerciseSectionId ?? null;
    activeLegacyQuestionId = question.id;
    workspaceEditorMode = 'question';
    workspacePanel = 'editor';
  }

  function openAssessmentComposer(sectionId: string | null) {
    newAssessmentComposerSectionId = sectionId;
    removeUntouchedLegacyQuestionDrafts();
  }

  function closeAssessmentWorkspace() {
    activeCanonicalQuestionId = null;
    pendingCanonicalQuestionId = null;
    newAssessmentComposerSectionId = undefined;
    promotedAssessmentQuestionId = null;
  }

  function onInitDeleteClicked(questionId) {
    return () => {
      deleteConfirmationType = 'question';
      questionIdToDelete = questionId;
      $deleteConfirmation.open = true;
    };
  }

  function onFinalDeleteClicked() {
    if (deleteConfirmationType === 'section' && sectionIdToDelete) {
      deleteSection(sectionIdToDelete);
      sectionIdToDelete = null;
      deleteConfirmationType = 'question';
      return;
    }

    handleRemoveQuestion(questionIdToDelete)();
    questionIdToDelete = null;
  }

  function onCancelDeleteClicked() {
    questionIdToDelete = null;
    sectionIdToDelete = null;
    deleteConfirmationType = 'question';
  }

  function getQuestionErrorMsg(
    errors: ExerciseEditorErrors,
    question: Question,
    errorKey: 'option' | 'title' | 'points'
  ) {
    return errors[question.id] ? errors[question.id][errorKey] : null;
  }

  function getSectionErrorMsg(errors: ExerciseEditorErrors, sectionId: string, errorKey: 'title' | 'description') {
    return errors[sectionId]?.[errorKey];
  }

  function makeDefaultOption() {
    return {
      id: `${new Date().getTime()}-form`,
      label: '',
      value: '',
      isCorrect: false
    };
  }

  function makeTrueFalseOptions(correctValue = true) {
    const ts = Date.now();
    return [
      { id: `${ts}-true-form`, label: 'True', value: 'true', isCorrect: correctValue },
      { id: `${ts}-false-form`, label: 'False', value: 'false', isCorrect: !correctValue }
    ];
  }

  function makeThumbsOptions() {
    const ts = Date.now();
    return [
      { id: `${ts}-yes-form`, label: 'Yes', value: 'true', isCorrect: false },
      { id: `${ts}-no-form`, label: 'No', value: 'false', isCorrect: false }
    ];
  }

  function onQuestionTypeChange(questionId: string | number, value: string) {
    if (!value) return;

    const nextQuestionType = getQuestionTypeOptionById(Number(value));
    const nextQuestionTypeKey = nextQuestionType.key;

    questionnaire.update((q) => {
      const idx = q.questions.findIndex((qu) => String(qu.id) === String(questionId));
      if (idx === -1) return q;

      const current = q.questions[idx];
      let nextOptions = current.options ?? [];
      let nextSettings = current.settings ?? {};

      if (nextQuestionTypeKey === QUESTION_TYPE_KEY.TRUE_FALSE) {
        const correctValue = (current.settings as { correctValue?: boolean })?.correctValue ?? true;
        nextSettings = { ...nextSettings, correctValue };
        nextOptions = makeTrueFalseOptions(correctValue);
      } else if (nextQuestionTypeKey === QUESTION_TYPE_KEY.THUMBS) {
        nextSettings = { ...nextSettings };
        nextOptions = makeThumbsOptions();
      } else if (questionTypeSupportsOptions(nextQuestionTypeKey)) {
        const hasActiveOptions = nextOptions.some((option) => !option.deletedAt);
        if (!hasActiveOptions) {
          nextOptions = [...nextOptions, makeDefaultOption()];
        }
      } else {
        nextOptions = [];
      }

      if (nextQuestionTypeKey === QUESTION_TYPE_KEY.VIDEO_RECORDING) {
        nextSettings = {
          ...nextSettings,
          maxDurationSeconds: 60,
          allowRetakes: true
        };
      }

      const next = [...q.questions];
      next[idx] = {
        ...current,
        questionType: nextQuestionType,
        questionTypeId: nextQuestionType.id,
        settings: nextSettings,
        options: nextOptions,
        isDirty: true
      };

      return { ...q, questions: next };
    });
  }

  function onSharedQuestionChange(questionId: string | number, nextQuestion) {
    questionnaire.update((q) => {
      const idx = q.questions.findIndex((qu) => String(qu.id) === String(questionId));
      if (idx === -1) return q;

      const current = q.questions[idx];
      const mappedOptions = Array.isArray(nextQuestion.options)
        ? nextQuestion.options.map((option, index) => {
            const optionId = option.id ?? current.options?.[index]?.id ?? `${new Date().getTime()}-${index}-form`;
            const optionLabel = option.label ?? '';

            return {
              id: optionId,
              label: optionLabel,
              value: option.value ?? optionLabel,
              isCorrect: option.isCorrect ?? false,
              settings:
                option.settings && typeof option.settings === 'object' && !Array.isArray(option.settings)
                  ? { ...option.settings }
                  : undefined
            };
          })
        : (current.options ?? []);

      let nextSettings = nextQuestion.settings ?? {};
      let nextOptions = mappedOptions;

      const currentQuestionTypeKey = getQuestionTypeKey(current);
      if (currentQuestionTypeKey === QUESTION_TYPE_KEY.TRUE_FALSE) {
        const correctValue = resolveTrueFalseCorrectValue(nextSettings, nextOptions);
        nextSettings = { ...nextSettings, correctValue };
        nextOptions = syncTrueFalseOptions(nextOptions, correctValue);
      }

      const next = [...q.questions];
      next[idx] = {
        ...current,
        title: nextQuestion.title,
        settings: nextSettings,
        options: nextOptions,
        isDirty: true
      };

      return { ...q, questions: next };
    });
  }

  function moveSection(sectionId: string, direction: -1 | 1) {
    const currentIndex = activeSections.findIndex((section) => section.id === sectionId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= activeSections.length) return;

    const orderedIds = activeSections.map((section) => section.id);
    const [sectionToMove] = orderedIds.splice(currentIndex, 1);
    orderedIds.splice(targetIndex, 0, sectionToMove);
    handleReorderSections(orderedIds);
  }

  function deleteSection(sectionId: string) {
    const sectionIndex = activeSections.findIndex((section) => section.id === sectionId);
    const nearestSection = activeSections[sectionIndex + 1] ?? activeSections[sectionIndex - 1];
    handleRemoveSection(sectionId, nearestSection?.id);
  }

  function onInitSectionDeleteClicked(sectionId: string) {
    deleteConfirmationType = 'section';
    sectionIdToDelete = sectionId;
    $deleteConfirmation.open = true;
  }

  function syncReorderQuestionItems() {
    reorderQuestionItemsBySectionId = Object.fromEntries(
      activeSections.map((section) => [
        section.id,
        getQuestionPlacementItemsForSection($questionnaire.questions, $questionnaire.canonicalQuestions, section.id)
      ])
    );
  }

  function getReorderQuestionsForSection(sectionId: string, sectionItems: ExerciseQuestionPlacementItem[]) {
    return reorderQuestionItemsBySectionId[sectionId] ?? sectionItems;
  }

  function handleSectionQuestionDndConsider(sectionId: string, event: QuestionDndEvent) {
    reorderQuestionItemsBySectionId = {
      ...reorderQuestionItemsBySectionId,
      [sectionId]: event.detail.items
    };
  }

  function handleSectionQuestionDndFinalize(sectionId: string, event: QuestionDndEvent) {
    reorderQuestionItemsBySectionId = {
      ...reorderQuestionItemsBySectionId,
      [sectionId]: event.detail.items
    };
    handleReorderQuestionPlacementItems(sectionId, event.detail.items);
  }

  function getRequiredQuestionCount(questions: Question[]) {
    return questions.filter((question) => toExerciseQuestionModel(question).required !== false).length;
  }

  function isQuestionAutoGradable(question: Question) {
    const questionTypeId = Number(question.questionTypeId ?? question.questionType?.id);
    if (!Number.isFinite(questionTypeId)) return false;

    return isAutoGradableQuestionTypeId(questionTypeId);
  }

  type SavedCanonicalQuestion = Pick<
    CanonicalQuestion,
    'title' | 'order' | 'exerciseSectionId' | 'points' | 'gradingMode' | 'revisionId' | 'revision' | 'definition'
  > & {
    questionId: number;
    authorDefinition: NonNullable<CanonicalQuestion['authorDefinition']>;
    hasNewerDraft: boolean;
  };

  function addCanonicalQuestionToState(item: SavedCanonicalQuestion) {
    questionnaire.update((state) => {
      const canonicalQuestion: CanonicalQuestion = {
        id: item.questionId,
        title: item.title,
        points: item.points,
        order: item.order,
        exerciseSectionId: item.exerciseSectionId,
        gradingMode: item.gradingMode,
        revisionId: item.revisionId,
        revision: item.revision,
        definition: item.definition,
        authorDefinition: item.authorDefinition
      };
      const existingQuestionIndex = state.canonicalQuestions.findIndex(
        (question) => Number(question.id) === item.questionId
      );
      if (existingQuestionIndex < 0) {
        return { ...state, canonicalQuestions: [...state.canonicalQuestions, canonicalQuestion] };
      }

      const canonicalQuestions = [...state.canonicalQuestions];
      canonicalQuestions[existingQuestionIndex] = {
        ...canonicalQuestions[existingQuestionIndex],
        ...canonicalQuestion
      };

      return { ...state, canonicalQuestions };
    });

    if (item.hasNewerDraft) {
      promotedAssessmentQuestionId = item.questionId;
      return;
    }

    promotedAssessmentQuestionId = null;
    newAssessmentComposerSectionId = undefined;
  }

  function updateCanonicalQuestionState(item: SavedCanonicalQuestion) {
    questionnaire.update((state) => ({
      ...state,
      canonicalQuestions: state.canonicalQuestions.map((question) =>
        Number(question.id) === item.questionId
          ? {
              ...question,
              title: item.title,
              points: item.points,
              gradingMode: item.gradingMode,
              revisionId: item.revisionId,
              revision: item.revision,
              definition: item.definition,
              authorDefinition: item.authorDefinition
            }
          : question
      )
    }));

    if (pendingCanonicalQuestionId !== null) {
      activeCanonicalQuestionId = pendingCanonicalQuestionId;
      pendingCanonicalQuestionId = null;
    }
  }

  function openCanonicalQuestionEditor(questionId: number) {
    activeWorkspaceSectionId =
      $questionnaire.canonicalQuestions.find((question) => Number(question.id) === questionId)?.exerciseSectionId ??
      null;
    workspaceEditorMode = 'question';
    workspacePanel = 'editor';
    if (activeCanonicalQuestionId === null) {
      activeCanonicalQuestionId = questionId;
      return;
    }

    if (activeCanonicalQuestionId === questionId) return;

    pendingCanonicalQuestionId = questionId;
    void onSaveRequested();
  }

  function getCanonicalQuestionsForSection(exerciseSectionId: string | null) {
    return $questionnaire.canonicalQuestions.filter(
      (question) => (question.exerciseSectionId ?? null) === exerciseSectionId
    );
  }

  const workspaceSectionId = $derived(activeWorkspaceSectionId ?? activeSections[0]?.id ?? null);
  const workspaceSection = $derived(activeSections.find((section) => section.id === workspaceSectionId) ?? null);
  const workspaceLegacyQuestions = $derived(getQuestionsForSection($questionnaire.questions, workspaceSectionId));
  const workspaceUnsectionedItems = $derived(
    getQuestionPlacementItemsForSection($questionnaire.questions, $questionnaire.canonicalQuestions, null)
  );
  const activeLegacyQuestion = $derived(
    workspaceLegacyQuestions.find((question) => String(question.id) === String(activeLegacyQuestionId)) ??
      workspaceLegacyQuestions[0] ??
      null
  );

  function getRenderedQuestionPlacementItems(exerciseSectionId: string | null) {
    const placementItems = getQuestionPlacementItemsForSection(
      $questionnaire.questions,
      $questionnaire.canonicalQuestions,
      exerciseSectionId
    );
    if (promotedAssessmentQuestionId === null || reorderQuestions) return placementItems;

    return placementItems.filter(
      (item) => item.kind !== 'canonical' || Number(item.question.id) !== promotedAssessmentQuestionId
    );
  }

  function getNextQuestionOrder(exerciseSectionId: string | null) {
    return (
      getQuestionPlacementItemsForSection(
        $questionnaire.questions,
        $questionnaire.canonicalQuestions,
        exerciseSectionId
      ).reduce((highestOrder, item) => Math.max(highestOrder, item.question.order ?? -1), -1) + 1
    );
  }

  $effect(() => {
    if (reorderQuestions && !previousReorderQuestions) {
      syncReorderQuestionItems();
    }

    if (!reorderQuestions && previousReorderQuestions) {
      reorderQuestionItemsBySectionId = {};
    }

    previousReorderQuestions = reorderQuestions;
  });
</script>

<DeleteConfirmationModal
  title={deleteConfirmationType === 'section'
    ? $t('course.navItem.lessons.exercises.all_exercises.delete_confirmation.section_title')
    : $t('course.navItem.lessons.exercises.all_exercises.delete_confirmation.title')}
  description={deleteConfirmationType === 'section'
    ? $t('course.navItem.lessons.exercises.all_exercises.delete_confirmation.section_sure')
    : $t('course.navItem.lessons.exercises.all_exercises.delete_confirmation.sure')}
  onCancel={onCancelDeleteClicked}
  onDelete={onFinalDeleteClicked}
/>

<OrderModal />

{#snippet gradingBadge(question)}
  {@const autoGradable = isQuestionAutoGradable(question)}
  <Tooltip.Provider>
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Badge
            {...props}
            variant="outline"
            class="absolute top-0 right-4 z-10 translate-y-[-50%] gap-1 bg-white font-normal dark:bg-black"
          >
            {autoGradable
              ? $t('course.navItem.lessons.exercises.all_exercises.edit_mode.question_type_auto_gradable')
              : $t('course.navItem.lessons.exercises.all_exercises.edit_mode.question_type_manual_grading')}
            <InfoIcon class="h-3 w-3" aria-hidden="true" />
          </Badge>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="top" sideOffset={6} class="max-w-xs">
        {autoGradable
          ? $t('course.navItem.lessons.exercises.all_exercises.edit_mode.question_type_auto_gradable_description')
          : $t('course.navItem.lessons.exercises.all_exercises.edit_mode.question_type_manual_grading_description')}
      </Tooltip.Content>
    </Tooltip.Root>
  </Tooltip.Provider>
{/snippet}

{#snippet questionEditor(question, index)}
  {@const questionStoreIndex = $questionnaire.questions.findIndex((item) => item.id === question.id)}
  <QuestionContainer
    elementId={getQuestionElementId(question.id)}
    key={String(question.id ?? `new-${index}`)}
    onClose={onInitDeleteClicked(question.id)}
    scrollToQuestion={shouldScrollToLast(question.id, $questionnaire.questions)}
    bind:points={$questionnaire.questions[questionStoreIndex].points}
    hasError={!!errors[question.id]}
    errorMsg={getQuestionErrorMsg(errors, question, 'points')}
    pointsHint={isQuestionAutoGradable(question) && requiresPositivePointsForAutoGrade
      ? $t('course.navItem.lessons.exercises.all_exercises.points_required_auto_grade')
      : null}
    onPointsChange={() => {
      question.isDirty = true;
    }}
  >
    {#if typeof question.code === 'string'}
      <div class="my-3 flex w-3/5 items-center justify-between">
        <TextareaField
          bind:value={question.code}
          rows={2}
          placeholder={$t('course.navItem.lessons.exercises.all_exercises.edit_mode.write')}
        />
        <IconButton onclick={() => handleCode(question.id, false)}>
          <TrashIcon size={16} />
        </IconButton>
      </div>
    {/if}

    {@render gradingBadge(question)}

    <div class="mt-2 flex flex-col">
      <ExerciseQuestion.QuestionRenderer
        showContainer={false}
        titleError={getQuestionErrorMsg(errors, question, 'title')}
        contract={{
          mode: 'edit',
          question: toExerciseQuestionModel(question),
          labels: questionLabels,
          platformMaxFileSizeMb,
          onImageUpload: uploadImage
        }}
        onQuestionChange={(nextQuestion) => onSharedQuestionChange(question.id, nextQuestion)}
      >
        {#snippet questionTypeSelect()}
          <QuestionTypeSelect
            value={question.questionTypeId?.toString()}
            onValueChange={(nextValue) => onQuestionTypeChange(question.id, nextValue)}
            triggerQuestionType={question?.questionType}
            types={availableQuestionTypes}
          />
        {/snippet}
      </ExerciseQuestion.QuestionRenderer>

      {#if getQuestionErrorMsg(errors, question, 'option')}
        <p class="text-sm text-red-500">{getQuestionErrorMsg(errors, question, 'option')}</p>
      {/if}
    </div>
  </QuestionContainer>
{/snippet}

{#snippet compactQuestionRow(question, index)}
  <div class="ui:border-border flex items-center gap-3 rounded-md border bg-white px-4 py-3 dark:bg-black">
    <span class="ui:text-muted-foreground w-6 text-sm font-medium tabular-nums">{index + 1}</span>
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-semibold">
        {richTextToPlainText(question.title) || getExerciseEditorQuestionTypeLabel(question?.questionType)}
      </p>
      <p class="ui:text-muted-foreground text-xs">{getExerciseEditorQuestionTypeLabel(question?.questionType)}</p>
    </div>
  </div>
{/snippet}

{#snippet compactCanonicalQuestionRow(question: CanonicalQuestion)}
  <div class="ui:border-border flex items-center gap-3 rounded-md border bg-white px-4 py-3 dark:bg-black">
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-semibold">{richTextToPlainText(question.title)}</p>
      <p class="ui:text-muted-foreground text-xs">
        <!-- What the row cannot show otherwise: a composite item holding a passage and six
             blanks is one row, and looked identical to a row holding a single question. -->
        {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.row_summary', {
          questions: countAssessmentQuestions(question),
          points: question.points ?? 0
        })}
        &middot;
        {$t(
          question.gradingMode === 'auto'
            ? 'course.navItem.lessons.exercises.all_exercises.question_auto_graded_badge'
            : 'course.navItem.lessons.exercises.all_exercises.question_manual_grading_badge'
        )}
      </p>
    </div>
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onclick={() => openCanonicalQuestionEditor(Number(question.id))}
    >
      {$t('course.navItem.lessons.exercises.all_exercises.view_mode.edit')}
    </Button>
  </div>
{/snippet}

{#snippet canonicalQuestionEditor(canonicalQuestion: CanonicalQuestion)}
  {#if courseApi.course?.id}
    <AssessmentItemComposer
      courseId={courseApi.course.id}
      exerciseId={_exerciseId}
      questionId={Number(canonicalQuestion.id)}
      exerciseSectionId={canonicalQuestion.exerciseSectionId}
      initialTitle={canonicalQuestion.title}
      initialDefinition={canonicalQuestion.authorDefinition}
      initialRevision={canonicalQuestion.revision}
      {onSaveRequested}
      onExitRequested={closeAssessmentWorkspace}
      onSaved={updateCanonicalQuestionState}
    />
  {/if}
{/snippet}

<div class="mb-20 w-full">
  {#if Object.values(errors).length}
    <div class="mb-4 flex w-full justify-center">
      <p class="text-sm text-red-500">{$t('course.navItem.lessons.exercises.all_exercises.edit_mode.error')}</p>
    </div>
  {/if}
  <div class="questions px-6 pt-6">
    {#if isAssessmentWorkspaceOpen}
      <section class="mb-6 min-w-0" data-assessment-workspace>
        {#if courseApi.course?.id && activeCanonicalQuestionId !== null}
          {@const activeCanonicalQuestion = $questionnaire.canonicalQuestions.find(
            (question) => Number(question.id) === activeCanonicalQuestionId
          )}
          {#if activeCanonicalQuestion}
            {@render canonicalQuestionEditor(activeCanonicalQuestion)}
          {/if}
        {:else if courseApi.course?.id && newAssessmentComposerSectionId !== undefined}
          <AssessmentItemComposer
            courseId={courseApi.course.id}
            exerciseId={_exerciseId}
            exerciseSectionId={newAssessmentComposerSectionId}
            initialOrder={getNextQuestionOrder(newAssessmentComposerSectionId)}
            {onSaveRequested}
            onExitRequested={closeAssessmentWorkspace}
            onSaved={addCanonicalQuestionToState}
          />
        {/if}
      </section>
    {/if}
    {#if USE_ASSESSMENT_WORKSPACE_PANEL && !isAssessmentWorkspaceOpen && !reorderQuestions}
      <section class="ui:border-border ui:bg-background overflow-hidden rounded-md border" data-assessment-workspace>
        <div class="ui:border-border flex min-h-14 flex-wrap items-center justify-between gap-3 border-b px-4 py-2">
          <div class="flex min-w-0 items-center gap-2">
            <ListChecksIcon class="ui:text-muted-foreground h-4 w-4 shrink-0" aria-hidden="true" />
            <h2 class="truncate text-sm font-semibold">
              {$t('course.navItem.lessons.exercises.all_exercises.questions')}
            </h2>
            <span class="ui:text-muted-foreground text-xs tabular-nums">
              {$questionnaire.questions.length + $questionnaire.canonicalQuestions.length}
            </span>
          </div>
          <div class="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              class="min-h-11"
              onclick={() => openAssessmentComposer(workspaceSectionId)}
            >
              <PlusIcon class="h-4 w-4" />
              {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.add')}
            </Button>
            <Button type="button" class="min-h-11" onclick={() => addQuestionToSection(workspaceSectionId)}>
              <PlusIcon class="h-4 w-4" />
              {sectionLabels.addQuestion}
            </Button>
          </div>
        </div>

        <div class="ui:bg-muted/50 grid grid-cols-2 gap-1 p-1 xl:hidden" aria-label={sectionLabels.questions}>
          <Button
            type="button"
            variant={workspacePanel === 'outline' ? 'secondary' : 'ghost'}
            class="min-h-11"
            aria-pressed={workspacePanel === 'outline'}
            onclick={() => (workspacePanel = 'outline')}
          >
            {$t('course.navItem.lessons.exercises.all_exercises.section.questions')}
          </Button>
          <Button
            type="button"
            variant={workspacePanel === 'editor' ? 'secondary' : 'ghost'}
            class="min-h-11"
            aria-pressed={workspacePanel === 'editor'}
            onclick={() => (workspacePanel = 'editor')}
          >
            {$t('course.navItem.lessons.exercises.all_exercises.view_mode.edit')}
          </Button>
        </div>

        <div
          class="xl:grid xl:max-h-[calc(100dvh-12rem)] xl:min-h-[40rem] xl:grid-cols-[minmax(18rem,3fr)_minmax(32rem,7fr)]"
        >
          <aside
            class:hidden={workspacePanel !== 'outline'}
            class="ui:border-border min-w-0 xl:block xl:overflow-y-auto xl:border-r"
            aria-label={$t('course.navItem.lessons.exercises.all_exercises.section.questions')}
          >
            {#if activeSections.length > 0}
              <nav class="space-y-4 p-3">
                {#each activeSections as section, sectionIndex (section.id)}
                  {@const sectionItems = getQuestionPlacementItemsForSection(
                    $questionnaire.questions,
                    $questionnaire.canonicalQuestions,
                    section.id
                  )}
                  <div class="ui:border-border overflow-hidden rounded-md border">
                    <div class="ui:bg-muted/30 flex items-center justify-between gap-2 px-3 py-2">
                      <Button
                        type="button"
                        variant={workspaceSectionId === section.id ? 'secondary' : 'ghost'}
                        class="min-h-11 min-w-0 flex-1 justify-start px-2 text-left"
                        aria-current={workspaceSectionId === section.id ? 'true' : undefined}
                        onclick={() => selectWorkspaceSection(section.id)}
                      >
                        <BookOpenTextIcon class="h-4 w-4 shrink-0" />
                        <span class="truncate">{richTextToPlainText(section.title) || `${sectionIndex + 1}`}</span>
                      </Button>
                      <span class="ui:text-muted-foreground text-xs tabular-nums">{sectionItems.length}</span>
                    </div>
                    <div class="space-y-1 p-2">
                      {#each sectionItems as item, index (item.id)}
                        <Button
                          type="button"
                          variant="ghost"
                          class="min-h-11 w-full justify-start gap-2 px-2 text-left"
                          aria-current={item.kind === 'legacy'
                            ? String(activeLegacyQuestion?.id) === String(item.question.id)
                            : Number(activeCanonicalQuestionId) === Number(item.question.id)}
                          onclick={() =>
                            item.kind === 'legacy'
                              ? selectLegacyQuestion(item.question)
                              : openCanonicalQuestionEditor(Number(item.question.id))}
                        >
                          <span class="ui:text-muted-foreground w-5 shrink-0 text-xs tabular-nums">{index + 1}</span>
                          <span class="truncate text-sm">
                            {richTextToPlainText(item.question.title) ||
                              getExerciseEditorQuestionTypeLabel(item.question.questionType)}
                          </span>
                        </Button>
                      {/each}
                    </div>
                  </div>
                {/each}
              </nav>
            {:else if workspaceUnsectionedItems.length > 0}
              <nav class="space-y-1 p-3">
                {#each workspaceUnsectionedItems as item, index (item.id)}
                  <Button
                    type="button"
                    variant="ghost"
                    class="min-h-11 w-full justify-start gap-2 px-2 text-left"
                    aria-current={item.kind === 'legacy'
                      ? String(activeLegacyQuestion?.id) === String(item.question.id)
                      : Number(activeCanonicalQuestionId) === Number(item.question.id)}
                    onclick={() =>
                      item.kind === 'legacy'
                        ? selectLegacyQuestion(item.question)
                        : openCanonicalQuestionEditor(Number(item.question.id))}
                  >
                    <span class="ui:text-muted-foreground w-5 shrink-0 text-xs tabular-nums">{index + 1}</span>
                    <span class="truncate text-sm">
                      {richTextToPlainText(item.question.title) ||
                        getExerciseEditorQuestionTypeLabel(item.question.questionType)}
                    </span>
                  </Button>
                {/each}
              </nav>
            {:else}
              <div class="flex min-h-80 flex-col items-center justify-center gap-3 p-6 text-center">
                <ListChecksIcon class="ui:text-muted-foreground h-8 w-8" aria-hidden="true" />
                <p class="ui:text-muted-foreground text-sm">
                  {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.empty_questions_helper')}
                </p>
              </div>
            {/if}
          </aside>

          <section
            class:hidden={workspacePanel !== 'editor'}
            class="min-w-0 xl:block xl:overflow-y-auto"
            aria-label={$t('course.navItem.lessons.exercises.all_exercises.view_mode.edit')}
          >
            {#if workspaceEditorMode === 'section' && workspaceSection}
              <div class="p-4 sm:p-6">
                <SectionEditor
                  exerciseSectionId={workspaceSection.id}
                  title={workspaceSection.title}
                  description={workspaceSection.description}
                  sectionNumber={activeSections.findIndex((section) => section.id === workspaceSection.id) + 1}
                  totalSections={activeSections.length}
                  colorTheme={workspaceSection.colorTheme}
                  questionCount={getQuestionsForSection($questionnaire.questions, workspaceSection.id).length +
                    getCanonicalQuestionsForSection(workspaceSection.id).length}
                  requiredQuestionCount={getRequiredQuestionCount(
                    getQuestionsForSection($questionnaire.questions, workspaceSection.id)
                  ) + getCanonicalQuestionsForSection(workspaceSection.id).length}
                  labels={sectionLabels}
                  titleError={getSectionErrorMsg(errors, workspaceSection.id, 'title')}
                  descriptionError={getSectionErrorMsg(errors, workspaceSection.id, 'description')}
                  onTitleChange={(title) => handleUpdateSectionTitle(workspaceSection.id, title)}
                  onDescriptionChange={(description) =>
                    handleUpdateSectionDescription(workspaceSection.id, description)}
                  onColorThemeChange={(colorTheme) => handleUpdateSectionColorTheme(workspaceSection.id, colorTheme)}
                  onAddQuestion={() => addQuestionToSection(workspaceSection.id)}
                  onDelete={() => onInitSectionDeleteClicked(workspaceSection.id)}
                  onMoveUp={() => moveSection(workspaceSection.id, -1)}
                  onMoveDown={() => moveSection(workspaceSection.id, 1)}
                  canMoveUp={activeSections[0]?.id !== workspaceSection.id}
                  canMoveDown={activeSections.at(-1)?.id !== workspaceSection.id}
                />
              </div>
            {:else if activeLegacyQuestion}
              <div class="p-4 sm:p-6">
                {@render questionEditor(
                  activeLegacyQuestion,
                  workspaceLegacyQuestions.findIndex((question) => question.id === activeLegacyQuestion?.id)
                )}
              </div>
            {:else}
              <div class="flex min-h-80 flex-col items-center justify-center gap-3 p-6 text-center">
                <Settings2Icon class="ui:text-muted-foreground h-8 w-8" aria-hidden="true" />
                <p class="ui:text-muted-foreground text-sm">
                  {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.empty_questions')}
                </p>
              </div>
            {/if}
          </section>
        </div>
      </section>
    {/if}
    {#if !isAssessmentWorkspaceOpen && (!USE_ASSESSMENT_WORKSPACE_PANEL || reorderQuestions)}
      <div data-legacy-question-list>
        {#if hasSections($questionnaire.sections)}
          <div class="space-y-5">
            {#each activeSections as section, sectionIndex (section.id)}
              {@const sectionQuestions = getQuestionsForSection($questionnaire.questions, section.id)}
              {@const canonicalSectionQuestions = getCanonicalQuestionsForSection(section.id)}
              {@const sectionPlacementItems = getRenderedQuestionPlacementItems(section.id)}
              {@const reorderSectionQuestions = getReorderQuestionsForSection(section.id, sectionPlacementItems)}
              <SectionEditor
                exerciseSectionId={section.id}
                title={section.title}
                description={section.description}
                sectionNumber={sectionIndex + 1}
                totalSections={activeSections.length}
                colorTheme={section.colorTheme}
                questionCount={countSectionQuestions(sectionQuestions.length, canonicalSectionQuestions)}
                requiredQuestionCount={countSectionQuestions(
                  getRequiredQuestionCount(sectionQuestions),
                  canonicalSectionQuestions
                )}
                labels={sectionLabels}
                titleError={getSectionErrorMsg(errors, section.id, 'title')}
                descriptionError={getSectionErrorMsg(errors, section.id, 'description')}
                showReorderHandles={reorderQuestions}
                onTitleChange={(title) => handleUpdateSectionTitle(section.id, title)}
                onDescriptionChange={(description) => handleUpdateSectionDescription(section.id, description)}
                onColorThemeChange={(colorTheme) => handleUpdateSectionColorTheme(section.id, colorTheme)}
                onAddQuestion={() => addQuestionToSection(section.id)}
                onDelete={() => onInitSectionDeleteClicked(section.id)}
                onMoveUp={() => moveSection(section.id, -1)}
                onMoveDown={() => moveSection(section.id, 1)}
                canMoveUp={sectionIndex > 0}
                canMoveDown={sectionIndex < activeSections.length - 1}
              >
                <div
                  class="space-y-2"
                  use:dndzone={{
                    items: reorderQuestions ? reorderSectionQuestions : sectionPlacementItems,
                    flipDurationMs,
                    dropTargetStyle: {
                      border: '2px #1d4ed8 solid',
                      'border-style': 'dashed',
                      'border-radius': '0.5rem'
                    },
                    dragDisabled: !reorderQuestions,
                    type: 'exercise-question-placement'
                  }}
                  onconsider={(event) => handleSectionQuestionDndConsider(section.id, event)}
                  onfinalize={(event) => handleSectionQuestionDndFinalize(section.id, event)}
                >
                  {#each reorderQuestions ? reorderSectionQuestions : sectionPlacementItems as item, index (item.id)}
                    <div
                      animate:flip={{ duration: flipDurationMs }}
                      class="flex items-start gap-3 transition {reorderQuestions
                        ? 'cursor-grab active:cursor-grabbing'
                        : ''}"
                    >
                      <div class="ui:text-muted-foreground flex w-5 shrink-0 flex-col items-center gap-2 pt-3">
                        {#if reorderQuestions}
                          <GripVerticalIcon class="h-4 w-4 cursor-grab active:cursor-grabbing" aria-hidden="true" />
                        {/if}
                        <span class="text-xs font-medium tabular-nums">{index + 1}</span>
                      </div>
                      <div class="min-w-0 flex-1">
                        {#if item.kind === 'legacy' && reorderQuestions}
                          {@render compactQuestionRow(item.question, index)}
                        {:else if item.kind === 'legacy'}
                          {@render questionEditor(item.question, index)}
                        {:else if reorderQuestions}
                          {@render compactCanonicalQuestionRow(item.question)}
                        {:else}
                          {@render compactCanonicalQuestionRow(item.question)}
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>
                {#if courseApi.course?.id && (newAssessmentComposerSectionId === section.id || !reorderQuestions)}
                  <div class="mt-4 space-y-4" hidden={reorderQuestions}>
                    {#if newAssessmentComposerSectionId !== section.id}
                      <Button type="button" variant="secondary" onclick={() => openAssessmentComposer(section.id)}>
                        {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.add')}
                      </Button>
                    {/if}
                  </div>
                {/if}
              </SectionEditor>

              <ExerciseQuestion.SectionAfterBehavior
                {sectionIndex}
                currentSectionId={section.id}
                allSections={activeSections}
                afterBehavior={section.afterBehavior}
                labels={sectionAfterBehaviorLabels}
                onChange={(behavior) => handleUpdateSectionAfterBehavior(section.id, behavior)}
              />
            {/each}
          </div>
        {:else}
          {#each getRenderedQuestionPlacementItems(null) as item, index (item.id)}
            {#if item.kind === 'legacy'}
              {@render questionEditor(item.question, index)}
            {:else}
              <div class="flex items-start gap-3">
                <span class="ui:text-muted-foreground w-5 shrink-0 pt-3 text-xs font-medium tabular-nums">
                  {index + 1}
                </span>
                <div class="min-w-0 flex-1">
                  {@render compactCanonicalQuestionRow(item.question)}
                </div>
              </div>
            {/if}
          {/each}
          {#if courseApi.course?.id && (newAssessmentComposerSectionId === null || !reorderQuestions)}
            <div class="mt-6 space-y-4" hidden={reorderQuestions}>
              {#if newAssessmentComposerSectionId !== null}
                <Button type="button" variant="secondary" onclick={() => openAssessmentComposer(null)}>
                  {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.add')}
                </Button>
              {/if}
            </div>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  :global(#dnd-action-dragged-el div) {
    z-index: 100;
  }
</style>
