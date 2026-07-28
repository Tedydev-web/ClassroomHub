<script lang="ts">
  import { getAssessmentVerticalSliceResponseProgress, getExerciseQuestionContractKey } from '@cio/question-types';
  import type {
    AnswerData,
    AssessmentDeliveryDefinition,
    AssessmentResponseEnvelope,
    ExerciseQuestionModel,
    ReleasedAssessmentFeedback
  } from '@cio/question-types';
  import type { Question } from '$features/course/types';
  import { Grade, ReasonBox } from '$features/ui/question';
  import { toExerciseQuestionModel } from './question-type-utils';
  import { getExerciseQuestionLabels } from './question-labels';
  import { ExerciseQuestion } from '@cio/ui';
  import { NumberBadge } from '@cio/ui/base/number-badge';
  import type { ExerciseSectionState, QuestionnaireMetaData } from './store';
  import { t } from '$lib/utils/functions/translations';
  import { getExerciseSectionDisplayHtml } from '$features/course/utils/exercise-section-utils';
  import { orderExerciseItemsBySections } from '$features/course/utils/exercise-progression-utils';

  type CanonicalPreviewQuestion = {
    id: string;
    title?: string | null;
    order?: number | null;
    exerciseSectionId?: string | null;
    definition: AssessmentDeliveryDefinition;
    feedback?: ReleasedAssessmentFeedback[];
  };

  type MixedPreviewItem =
    | {
        kind: 'legacy';
        id: string;
        order: number;
        exerciseSectionId: string | null;
        sourceIndex: number;
        question: Question;
        questionModel: ExerciseQuestionModel;
      }
    | {
        kind: 'canonical';
        id: string;
        order: number;
        exerciseSectionId: string | null;
        sourceIndex: number;
        question: CanonicalPreviewQuestion;
      };

  interface Props {
    questions?: Question[];
    sections?: ExerciseSectionState[];
    questionnaireMetaData?: Partial<QuestionnaireMetaData>;
    /** Per-question scores (e.g. from `questionnaireMetaData.grades` or grading modal `questionAnswerByPoint`). */
    grades?: Record<string, number>;
    disableGrading?: boolean;
    isGradeWithAI?: boolean;
    isLoading?: boolean;
    /** Optional AI grading copy keyed by question id. */
    reasons?: Record<string, string>;
    canonicalQuestions?: CanonicalPreviewQuestion[];
    canonicalAnswers?: Record<string, AssessmentResponseEnvelope | undefined>;
  }

  let {
    questions = [],
    sections = [],
    questionnaireMetaData: _questionnaireMetaData = {},
    grades = $bindable({}),
    disableGrading = true,
    isGradeWithAI = $bindable(false),
    isLoading = $bindable(false),
    reasons = $bindable({}),
    canonicalQuestions = [],
    canonicalAnswers = {}
  }: Props = $props();

  function acceptGradeSuggestion() {
    isGradeWithAI = false;
  }

  function rejectGradeSuggestion(questionId: Question['id']) {
    isGradeWithAI = false;
    grades[String(questionId)] = 0;
  }

  function getAnswerForQuestion(questionModel: ExerciseQuestionModel, fallbackIndex = 0): AnswerData | undefined {
    const questionKey = getExerciseQuestionContractKey(questionModel, fallbackIndex);
    return _questionnaireMetaData?.answers?.[questionKey];
  }

  const questionModels = $derived(questions.map((question) => toExerciseQuestionModel(question)));
  const questionLabels = $derived(getExerciseQuestionLabels());
  const sectionFallbackTitle = $derived($t('course.navItem.lessons.exercises.all_exercises.section.fallback_title'));
  const activeSections = $derived(sections.filter((section) => !section.deletedAt).sort((a, b) => a.order - b.order));
  const hasSectionGroups = $derived(activeSections.length > 0);
  const showMixedGradeControls = $derived(!disableGrading || Object.keys(grades || {}).length > 0);
  const mixedPreviewItems = $derived.by(() => {
    const legacyItems: MixedPreviewItem[] = questions
      .filter((question) => !question.deletedAt)
      .map((question, sourceIndex) => ({
        kind: 'legacy',
        id: String(question.id),
        order: typeof question.order === 'number' && Number.isFinite(question.order) ? question.order : sourceIndex,
        exerciseSectionId: question.exerciseSectionId ?? null,
        sourceIndex,
        question,
        questionModel: toExerciseQuestionModel(question)
      }));
    const canonicalItems: MixedPreviewItem[] = canonicalQuestions.map((question, canonicalIndex) => ({
      kind: 'canonical',
      id: question.id,
      order:
        typeof question.order === 'number' && Number.isFinite(question.order)
          ? question.order
          : questions.length + canonicalIndex,
      exerciseSectionId: question.exerciseSectionId ?? null,
      sourceIndex: questions.length + canonicalIndex,
      question
    }));

    return orderExerciseItemsBySections([...legacyItems, ...canonicalItems], activeSections);
  });
  const questionNumberStartByItemId = $derived.by(() => {
    const numberStartByItemId: Record<string, number> = {};
    let nextQuestionNumber = 1;

    for (const item of mixedPreviewItems) {
      numberStartByItemId[item.id] = nextQuestionNumber;
      nextQuestionNumber += getMixedItemQuestionCount(item);
    }

    return numberStartByItemId;
  });
  const unsectionedMixedPreviewItems = $derived(mixedPreviewItems.filter((item) => item.exerciseSectionId === null));
  const answersByKey = $derived(
    questionModels.reduce(
      (acc, questionModel, index) => {
        const questionKey = getExerciseQuestionContractKey(questionModel, index);
        acc[questionKey] = _questionnaireMetaData?.answers?.[questionKey];
        return acc;
      },
      {} as Record<string, AnswerData>
    )
  );

  function getQuestionsForSection(exerciseSectionId: string) {
    return questions.filter((question) => !question.deletedAt && question.exerciseSectionId === exerciseSectionId);
  }

  function getSectionPoints(sectionQuestions: Question[]) {
    return sectionQuestions.reduce((total, question) => total + Number(question.points ?? 0), 0);
  }

  function getMixedItemsForSection(exerciseSectionId: string) {
    return mixedPreviewItems.filter((item) => item.exerciseSectionId === exerciseSectionId);
  }

  function getMixedItemMaxPoints(item: MixedPreviewItem) {
    return item.kind === 'legacy'
      ? Number(item.question.points ?? 0)
      : getCanonicalQuestionMaxPoints(item.question.definition);
  }

  function getMixedItemsPoints(items: MixedPreviewItem[]) {
    return items.reduce((total, item) => total + getMixedItemMaxPoints(item), 0);
  }

  function getMixedItemQuestionCount(item: MixedPreviewItem): number {
    if (item.kind === 'legacy') return 1;

    return getAssessmentVerticalSliceResponseProgress(item.question.definition, undefined).total;
  }

  function getMixedItemsQuestionCount(items: MixedPreviewItem[]): number {
    return items.reduce((total, item) => total + getMixedItemQuestionCount(item), 0);
  }

  function getCanonicalQuestionMaxPoints(definition: AssessmentDeliveryDefinition) {
    return definition.blocks.reduce((total, block) => {
      if (block.kind === 'content') return total;

      return total + block.interaction.maxScore;
    }, 0);
  }

  function canonicalQuestionRequiresManualGrading(definition: AssessmentDeliveryDefinition) {
    return definition.blocks.some((block) => block.kind === 'interaction' && block.interaction.kind === 'text');
  }
</script>

{#snippet mixedPreviewItem(item: MixedPreviewItem, questionNumber: number)}
  <div class="mb-4 space-y-3">
    {#if showMixedGradeControls}
      <div class="flex items-center justify-between gap-2">
        <NumberBadge number={questionNumber} active />
        {#if disableGrading}
          <Grade grade={grades[item.id]} gradeMax={getMixedItemMaxPoints(item)} disableGrading={true} />
        {:else}
          <Grade
            bind:grade={grades[item.id]}
            gradeMax={getMixedItemMaxPoints(item)}
            disableGrading={item.kind === 'canonical' &&
              !canonicalQuestionRequiresManualGrading(item.question.definition)}
          />
        {/if}
      </div>
    {/if}

    {#if item.kind === 'legacy'}
      <ExerciseQuestion.QuestionRenderer
        contract={{
          mode: 'review',
          question: item.questionModel,
          answer: getAnswerForQuestion(item.questionModel, item.sourceIndex),
          labels: questionLabels,
          disabled: true
        }}
        questionNumber={showMixedGradeControls ? undefined : questionNumber}
        questionNumberActive={false}
      />

      {#if isGradeWithAI}
        <ReasonBox
          reason={reasons[item.question.id]}
          {isLoading}
          acceptGrade={acceptGradeSuggestion}
          rejectGrade={() => rejectGradeSuggestion(item.question.id)}
        />
      {/if}
    {:else}
      <ExerciseQuestion.AssessmentItemRenderer
        definition={item.question.definition}
        response={canonicalAnswers[item.id]}
        feedback={item.question.feedback}
        feedbackLabel={$t('profileMenu.feedback')}
        disabled
        title={item.question.title}
        trueLabel={$t('course.navItem.lessons.exercises.all_exercises.shared_question.true_false.true_label')}
        falseLabel={$t('course.navItem.lessons.exercises.all_exercises.shared_question.true_false.false_label')}
        questionNumber={showMixedGradeControls ? undefined : questionNumber}
        interactionNumberStart={questionNumber}
        questionNumberActive={false}
        showContainer
      />
    {/if}
  </div>
{/snippet}

{#if canonicalQuestions.length > 0}
  {#if hasSectionGroups}
    <div class="space-y-6">
      {#each activeSections as section, sectionIndex (section.id)}
        {@const sectionItems = getMixedItemsForSection(section.id)}
        <section class="space-y-4 pt-4">
          <ExerciseQuestion.SectionHeader
            title={getExerciseSectionDisplayHtml({
              title: section.title,
              sectionNumber: sectionIndex + 1,
              sectionLabel: sectionFallbackTitle
            })}
            description={section.description}
            sectionNumber={sectionIndex + 1}
            totalSections={activeSections.length}
            colorTheme={section.colorTheme}
            questionCount={getMixedItemsQuestionCount(sectionItems)}
            totalPoints={getMixedItemsPoints(sectionItems)}
            labels={{
              section: $t('course.navItem.lessons.exercises.all_exercises.section.fallback_title'),
              questions: $t('course.navItem.lessons.exercises.all_exercises.view_mode.questions'),
              points: $t('course.navItem.lessons.exercises.all_exercises.view_mode.points')
            }}
          />

          {#each sectionItems as item, itemIndex (item.id)}
            {@render mixedPreviewItem(item, questionNumberStartByItemId[item.id] ?? itemIndex + 1)}
          {/each}
        </section>
      {/each}
    </div>

    {#each unsectionedMixedPreviewItems as item, itemIndex (item.id)}
      {@render mixedPreviewItem(
        item,
        questionNumberStartByItemId[item.id] ??
          mixedPreviewItems.length - unsectionedMixedPreviewItems.length + itemIndex + 1
      )}
    {/each}
  {:else}
    {#each mixedPreviewItems as item, itemIndex (item.id)}
      {@render mixedPreviewItem(item, questionNumberStartByItemId[item.id] ?? itemIndex + 1)}
    {/each}
  {/if}
{:else if hasSectionGroups}
  <div class="space-y-6">
    {#each activeSections as section, sectionIndex (section.id)}
      {@const sectionQuestions = getQuestionsForSection(section.id)}
      {@const sectionQuestionModels = sectionQuestions.map((question) => toExerciseQuestionModel(question))}
      <section class="space-y-4 pt-4">
        <ExerciseQuestion.SectionHeader
          title={getExerciseSectionDisplayHtml({
            title: section.title,
            sectionNumber: sectionIndex + 1,
            sectionLabel: sectionFallbackTitle
          })}
          description={section.description}
          sectionNumber={sectionIndex + 1}
          totalSections={activeSections.length}
          colorTheme={section.colorTheme}
          questionCount={sectionQuestions.length}
          totalPoints={getSectionPoints(sectionQuestions)}
          labels={{
            section: $t('course.navItem.lessons.exercises.all_exercises.section.fallback_title'),
            questions: $t('course.navItem.lessons.exercises.all_exercises.view_mode.questions'),
            points: $t('course.navItem.lessons.exercises.all_exercises.view_mode.points')
          }}
        />

        <ExerciseQuestion.QuestionList
          contract={{
            mode: disableGrading ? 'review' : 'review',
            questions: sectionQuestionModels,
            answersByKey,
            labels: questionLabels,
            disabled: true
          }}
          itemClass="mb-4"
        />
      </section>
    {/each}
  </div>
{:else if disableGrading && !Object.keys(grades || {}).length}
  <ExerciseQuestion.QuestionList
    contract={{ mode: 'review', questions: questionModels, answersByKey, labels: questionLabels, disabled: true }}
    itemClass="mb-4"
  />
{:else if disableGrading && Object.keys(grades || {}).length}
  {#each questions as currentQuestion, index (currentQuestion.id)}
    {@const questionModel = questionModels[index]}
    <div class="mb-4 space-y-3">
      <div class="flex items-center justify-between gap-2">
        <NumberBadge number={index + 1} active />
        <Grade grade={grades[currentQuestion.id]} gradeMax={currentQuestion.points} disableGrading={true} />
      </div>

      <ExerciseQuestion.QuestionRenderer
        contract={{
          mode: 'review',
          question: questionModel,
          answer: getAnswerForQuestion(questionModel, index),
          labels: questionLabels,
          disabled: true
        }}
      />
    </div>
  {/each}
{:else}
  {#each questions as currentQuestion, index (currentQuestion.id)}
    {@const questionModel = questionModels[index]}
    <div class="mb-4 space-y-3">
      <div class="flex items-center justify-between gap-2">
        <NumberBadge number={index + 1} active />
        <Grade bind:grade={grades[currentQuestion.id]} gradeMax={currentQuestion.points} {disableGrading} />
      </div>

      <ExerciseQuestion.QuestionRenderer
        contract={{
          mode: 'review',
          question: questionModel,
          answer: getAnswerForQuestion(questionModel, index),
          labels: questionLabels,
          disabled: true
        }}
      />

      {#if isGradeWithAI}
        <ReasonBox
          reason={reasons[currentQuestion.id]}
          {isLoading}
          acceptGrade={acceptGradeSuggestion}
          rejectGrade={() => rejectGradeSuggestion(currentQuestion.id)}
        />
      {/if}
    </div>
  {/each}
{/if}
