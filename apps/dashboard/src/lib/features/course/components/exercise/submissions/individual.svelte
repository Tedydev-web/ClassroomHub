<script lang="ts">
  import { Spinner } from '@cio/ui/base/spinner';
  import { ExerciseQuestion } from '@cio/ui';
  import { UserAvatar } from '@cio/ui/custom/user-avatar';
  import { Badge } from '@cio/ui/base/badge';
  import * as Select from '@cio/ui/base/select';

  import { getQuestionsForSection, questionnaire } from '../store';
  import { t } from '$lib/utils/functions/translations';
  import type { Question } from '$features/course/types';
  import { getAssessmentVerticalSliceResponseProgress, type AnswerData } from '@cio/question-types';
  import { toExerciseQuestionModel } from '../question-type-utils';
  import { getExerciseQuestionLabels } from '../question-labels';
  import { getExerciseSectionDisplayHtml } from '$features/course/utils/exercise-section-utils';
  import {
    formatExercisePoints,
    getActiveExerciseQuestions,
    orderExerciseItemsBySections,
    roundExercisePointsForDisplay,
    shouldCompleteExerciseFromSubmission,
    type ExerciseSubmissionStudentGroup
  } from '$features/course/utils/exercise-progression-utils';
  import {
    getCanonicalAssessmentReviewItems,
    sumAnswerScoresForRenderedQuestions,
    type CanonicalAssessmentReviewItem
  } from '$features/course/utils/submission-review-score-utils';
  import type { SubmissionListItem } from '$features/course/utils/types';

  interface Props {
    isLoading?: boolean;
    submissionGroups?: ExerciseSubmissionStudentGroup[];
  }

  interface ReviewQuestionRef {
    id: string | number;
    points?: number | null;
  }

  interface CanonicalReviewScore {
    score: number;
    maxScore: number;
  }

  type MixedReviewItem =
    | { id: string; kind: 'legacy'; question: Question }
    | {
        id: string;
        kind: 'canonical';
        question: CanonicalAssessmentReviewItem['question'];
        reviewItem: CanonicalAssessmentReviewItem;
      };

  let { isLoading = $bindable(false), submissionGroups = [] }: Props = $props();

  let studentSelected = $state(0);
  let selectedAttemptByStudentKey = $state<Record<string, number>>({});
  const questionLabels = $derived(getExerciseQuestionLabels());
  const sectionFallbackTitle = $derived($t('course.navItem.lessons.exercises.all_exercises.section.fallback_title'));
  const activeSections = $derived(
    [...($questionnaire.sections ?? [])].filter((section) => !section.deletedAt).sort((a, b) => a.order - b.order)
  );
  const hasSectionGroups = $derived(activeSections.length > 0);

  function toNumericQuestionId(question: Question): number | null {
    const numericId = Number(question.id);
    return Number.isNaN(numericId) ? null : numericId;
  }

  function getStudentAnswerForQuestion(submission: SubmissionListItem, question: Question): AnswerData | undefined {
    if (!submission?.answers) return undefined;

    const questionId = toNumericQuestionId(question);
    if (questionId === null) return undefined;

    const submittedAnswer = submission.answers.find((answer) => answer.questionId === questionId);
    if (
      !submittedAnswer?.answerData ||
      typeof submittedAnswer.answerData !== 'object' ||
      !('type' in submittedAnswer.answerData)
    )
      return undefined;

    return submittedAnswer.answerData;
  }

  function getSectionScore(submission: SubmissionListItem, questions: ReviewQuestionRef[]) {
    return sumAnswerScoresForRenderedQuestions(questions, submission.answers);
  }

  function getSectionMaxPoints(questions: ReviewQuestionRef[]) {
    return questions.reduce((total, question) => total + Number(question.points ?? 0), 0);
  }

  function getCanonicalReviewScore(items: ReadonlyArray<CanonicalReviewScore>) {
    return items.reduce((total, item) => total + item.score, 0);
  }

  function getCanonicalReviewMaxPoints(items: ReadonlyArray<CanonicalReviewScore>) {
    return items.reduce((total, item) => total + item.maxScore, 0);
  }

  function getCanonicalReviewItemsForSection(submission: SubmissionListItem, exerciseSectionId: string) {
    return getCanonicalAssessmentReviewItems($questionnaire.canonicalQuestions, submission.answers).filter(
      (item) => item.question.exerciseSectionId === exerciseSectionId
    );
  }

  function getMixedReviewItems(submission: SubmissionListItem): MixedReviewItem[] {
    const legacyItems: MixedReviewItem[] = getActiveExerciseQuestions($questionnaire.questions).map((question) => ({
      id: `legacy:${question.id}`,
      kind: 'legacy',
      question
    }));
    const canonicalItems: MixedReviewItem[] = getCanonicalAssessmentReviewItems(
      $questionnaire.canonicalQuestions,
      submission.answers
    ).map((reviewItem) => ({
      id: `canonical:${reviewItem.question.id}`,
      kind: 'canonical',
      question: reviewItem.question,
      reviewItem
    }));

    return orderExerciseItemsBySections([...legacyItems, ...canonicalItems], activeSections);
  }

  function getMixedReviewItemQuestionCount(item: MixedReviewItem): number {
    if (item.kind === 'legacy') return 1;

    return getAssessmentVerticalSliceResponseProgress(item.reviewItem.definition, item.reviewItem.response).total;
  }

  function getMixedReviewQuestionCount(items: MixedReviewItem[]): number {
    return items.reduce((total, item) => total + getMixedReviewItemQuestionCount(item), 0);
  }

  function getQuestionNumberStartByReviewItemId(items: MixedReviewItem[]): Record<string, number> {
    const numberStartByItemId: Record<string, number> = {};
    let nextQuestionNumber = 1;

    for (const item of items) {
      numberStartByItemId[item.id] = nextQuestionNumber;
      nextQuestionNumber += getMixedReviewItemQuestionCount(item);
    }

    return numberStartByItemId;
  }

  // Numerator and denominator share the same rendered active question set:
  // answers to questions archived after the attempt are excluded so the
  // displayed score never exceeds the displayed maximum.
  function getTotalScore(submission: SubmissionListItem) {
    const activeLegacyQuestions = getActiveExerciseQuestions($questionnaire.questions);
    const legacyScore = sumAnswerScoresForRenderedQuestions(activeLegacyQuestions, submission.answers);
    const canonicalReviewItems = getCanonicalAssessmentReviewItems(
      $questionnaire.canonicalQuestions,
      submission.answers
    );

    return legacyScore + getCanonicalReviewScore(canonicalReviewItems);
  }

  function getTotalPossiblePoints(submission: SubmissionListItem) {
    const activeLegacyQuestions = getActiveExerciseQuestions($questionnaire.questions);
    const canonicalReviewItems = getCanonicalAssessmentReviewItems(
      $questionnaire.canonicalQuestions,
      submission.answers
    );

    return getSectionMaxPoints(activeLegacyQuestions) + getCanonicalReviewMaxPoints(canonicalReviewItems);
  }

  function formatSubmittedAt(submission: SubmissionListItem) {
    const createdAt = (submission as SubmissionListItem & { createdAt?: string | Date | null }).createdAt;
    if (!createdAt) return t.get('course.navItem.lessons.exercises.all_exercises.analytics.individual.date_unknown');

    return new Date(createdAt).toLocaleString();
  }

  function getStatusLabel(submission: SubmissionListItem & { gradingState?: string | null }) {
    if (submission.gradingState === 'awaiting_manual') {
      return t.get('course.navItem.lessons.exercises.all_exercises.analytics.individual.status_awaiting_manual');
    }

    if (submission.gradingState === 'completed' || submission.statusId === 3) {
      return t.get('course.navItem.lessons.exercises.all_exercises.analytics.individual.status_completed');
    }

    return t.get('course.navItem.lessons.exercises.all_exercises.analytics.individual.status_pending');
  }

  function getAttemptPassLabel(submission: SubmissionListItem & { gradingState?: string | null }) {
    return didAttemptCompleteExercise(submission)
      ? ($questionnaire.completionPolicy ?? 'submitted') === 'submitted'
        ? t.get('course.navItem.lessons.exercises.all_exercises.analytics.individual.counts_as_complete')
        : t.get('course.navItem.lessons.exercises.all_exercises.analytics.individual.passed')
      : t.get('course.navItem.lessons.exercises.all_exercises.analytics.individual.not_passed');
  }

  function didAttemptCompleteExercise(submission: SubmissionListItem & { gradingState?: string | null }) {
    return shouldCompleteExerciseFromSubmission({
      completionPolicy: $questionnaire.completionPolicy,
      passThreshold: $questionnaire.passThreshold,
      totalPossiblePoints: getTotalPossiblePoints(submission),
      submission
    });
  }

  function getSelectedGroup() {
    return submissionGroups[studentSelected] ?? submissionGroups[0];
  }

  function getSelectedAttemptIndex(group: ExerciseSubmissionStudentGroup) {
    const selectedAttemptIndex = selectedAttemptByStudentKey[group.studentKey] ?? group.attempts.length - 1;
    if (selectedAttemptIndex < 0 || selectedAttemptIndex >= group.attempts.length) return group.attempts.length - 1;

    return selectedAttemptIndex;
  }

  function selectAttempt(group: ExerciseSubmissionStudentGroup, value: string) {
    const selectedAttemptIndex = Number(value);
    if (Number.isNaN(selectedAttemptIndex)) return;

    selectedAttemptByStudentKey = {
      ...selectedAttemptByStudentKey,
      [group.studentKey]: selectedAttemptIndex
    };
  }
</script>

{#snippet reviewItem(item: MixedReviewItem, questionNumber: number, selectedSubmission: SubmissionListItem)}
  <div class="pb-4">
    {#if item.kind === 'legacy'}
      <ExerciseQuestion.QuestionRenderer
        contract={{
          mode: 'review',
          question: toExerciseQuestionModel(item.question),
          answer: getStudentAnswerForQuestion(selectedSubmission, item.question),
          labels: questionLabels,
          disabled: true
        }}
        {questionNumber}
        questionNumberActive={false}
      />
    {:else}
      <ExerciseQuestion.AssessmentItemRenderer
        definition={item.reviewItem.definition}
        response={item.reviewItem.response}
        feedback={item.reviewItem.feedback}
        feedbackLabel={$t('profileMenu.feedback')}
        disabled
        title={item.question.title}
        trueLabel={$t('course.navItem.lessons.exercises.all_exercises.shared_question.true_false.true_label')}
        falseLabel={$t('course.navItem.lessons.exercises.all_exercises.shared_question.true_false.false_label')}
        {questionNumber}
        interactionNumberStart={questionNumber}
        questionNumberActive={false}
        showContainer
      />
    {/if}
  </div>
{/snippet}

{#if isLoading}
  <Spinner />
{:else if submissionGroups?.length}
  <div class="mt-2 mb-5 flex w-full gap-1 overflow-auto">
    {#each submissionGroups as studentGroup, i (studentGroup.studentKey)}
      <button onclick={() => (studentSelected = i)} class="flex w-20 flex-col items-center">
        <div
          class={`flex h-12 w-12 items-center justify-center rounded-full ${
            studentSelected == i ? 'border-primary-700 border-[3px]' : ''
          }`}
        >
          <UserAvatar
            src={studentGroup.studentAvatarUrl}
            alt={$t('course.navItem.lessons.exercises.all_exercises.analytics.individual.student_avatar')}
            class="m-1 size-10"
          />
        </div>
        <p class="line-clamp-2 w-20 leading-4 whitespace-pre-wrap">
          {studentGroup.studentName}
        </p>
      </button>
    {/each}
  </div>

  {@const selectedGroup = getSelectedGroup()}
  {#if selectedGroup}
    {@const selectedAttemptIndex = getSelectedAttemptIndex(selectedGroup)}
    {@const selectedAttempt = selectedGroup.attempts[selectedAttemptIndex]}
    {@const selectedSubmission = selectedAttempt.submission}
    <div class="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <p class="font-medium">
          {$t('course.navItem.lessons.exercises.all_exercises.analytics.individual.answers_for', {
            name: selectedGroup.studentName
          })}
        </p>
        <p class="ui:text-muted-foreground text-sm">
          {$t('course.navItem.lessons.exercises.all_exercises.analytics.individual.attempts_count', {
            count: selectedGroup.attempts.length
          })}
        </p>
      </div>

      <div class="w-full md:w-80">
        <Select.Root
          type="single"
          value={String(selectedAttemptIndex)}
          onValueChange={(value) => selectAttempt(selectedGroup, value)}
        >
          <Select.Trigger class="w-full">
            {$t('course.navItem.lessons.exercises.all_exercises.analytics.individual.attempt_label', {
              number: selectedAttempt.attemptNumber
            })}
            -
            {getStatusLabel(selectedSubmission)}
          </Select.Trigger>
          <Select.Content>
            {#each selectedGroup.attempts as attempt, attemptIndex (attempt.submission.id)}
              {@const attemptScore = getTotalScore(attempt.submission)}
              <Select.Item value={String(attemptIndex)}>
                {$t('course.navItem.lessons.exercises.all_exercises.analytics.individual.attempt_label', {
                  number: attempt.attemptNumber
                })}
                -
                {formatSubmittedAt(attempt.submission)}
                -
                {getStatusLabel(attempt.submission)}
                -
                {formatExercisePoints(attemptScore)}/{formatExercisePoints(getTotalPossiblePoints(attempt.submission))}
                -
                {getAttemptPassLabel(attempt.submission)}
              </Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
    </div>

    <div class="mb-4 flex flex-wrap items-center gap-2">
      <Badge variant="outline">{getStatusLabel(selectedSubmission)}</Badge>
      <Badge variant="secondary">
        {formatExercisePoints(getTotalScore(selectedSubmission))}/{formatExercisePoints(
          getTotalPossiblePoints(selectedSubmission)
        )}
        {$t('course.navItem.lessons.exercises.all_exercises.view_mode.points')}
      </Badge>
      <Badge variant={didAttemptCompleteExercise(selectedSubmission) ? 'success' : 'warning'}>
        {getAttemptPassLabel(selectedSubmission)}
      </Badge>
    </div>

    {@const mixedReviewItems = getMixedReviewItems(selectedSubmission)}
    {@const questionNumberStartByReviewItemId = getQuestionNumberStartByReviewItemId(mixedReviewItems)}
    {#if hasSectionGroups}
      <div class="space-y-8">
        {#each activeSections as section, sectionIndex (section.id)}
          {@const sectionQuestions = getQuestionsForSection($questionnaire.questions, section.id)}
          {@const canonicalSectionReviewItems = getCanonicalReviewItemsForSection(selectedSubmission, section.id)}
          {@const sectionReviewItems = mixedReviewItems.filter(
            (item) => item.question.exerciseSectionId === section.id
          )}
          <section class="space-y-4">
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
              questionCount={getMixedReviewQuestionCount(sectionReviewItems)}
              totalPoints={roundExercisePointsForDisplay(
                getSectionMaxPoints(sectionQuestions) + getCanonicalReviewMaxPoints(canonicalSectionReviewItems)
              )}
              labels={{
                section: $t('course.navItem.lessons.exercises.all_exercises.section.fallback_title'),
                questions: $t('course.navItem.lessons.exercises.all_exercises.view_mode.questions'),
                points: $t('course.navItem.lessons.exercises.all_exercises.view_mode.points')
              }}
            />

            {#each sectionReviewItems as item, itemIndex (item.id)}
              {@render reviewItem(
                item,
                questionNumberStartByReviewItemId[item.id] ?? itemIndex + 1,
                selectedSubmission
              )}
            {/each}

            <p class="border-t pt-2 text-sm font-medium">
              {formatExercisePoints(
                getSectionScore(selectedSubmission, sectionQuestions) +
                  getCanonicalReviewScore(canonicalSectionReviewItems)
              )}/{formatExercisePoints(
                getSectionMaxPoints(sectionQuestions) + getCanonicalReviewMaxPoints(canonicalSectionReviewItems)
              )}
              {$t('course.navItem.lessons.exercises.all_exercises.view_mode.points')}
            </p>
          </section>
        {/each}
      </div>
    {:else}
      {#each mixedReviewItems as item, itemIndex (item.id)}
        {@render reviewItem(item, questionNumberStartByReviewItemId[item.id] ?? itemIndex + 1, selectedSubmission)}
      {/each}
    {/if}
  {/if}
{/if}
