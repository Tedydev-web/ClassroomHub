<script lang="ts">
  import { get } from 'svelte/store';
  import { onDestroy, tick, untrack } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { fly } from 'svelte/transition';
  import { cubicInOut } from 'svelte/easing';
  import { courseApi } from '$features/course/api';
  import {
    assessmentComposerPreviewItems,
    getQuestionsForSection,
    hasSections,
    questionnaire,
    questionnaireMetaData,
    resetStudentExerciseTake
  } from './store';
  import Preview from './preview.svelte';
  import { ExerciseQuestion } from '@cio/ui';
  import * as Alert from '@cio/ui/base/alert';
  import { Badge } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import { RoleBasedSecurity } from '$features/ui';
  import { Empty } from '@cio/ui/custom/empty';
  import FileQuestionIcon from '@lucide/svelte/icons/file-question';
  import { Progress } from '@cio/ui/base/progress';
  import {
    assessmentResponseEnvelopeSchema,
    getExerciseQuestionContractKey,
    getAssessmentVerticalSliceResponseProgress,
    isAssessmentVerticalSliceResponseComplete,
    parseAssessmentDeliveryDefinition
  } from '@cio/question-types';
  import { STATUS } from './constants';
  import { filterOutDeleted } from './functions';
  import { formatAnswers } from '$features/course/utils/functions';
  import {
    hasMeaningfulAnswerData,
    resolveCanonicalFileUploadMimeType,
    toApiPayload,
    type AnswerData,
    type ApiPayload,
    type ExerciseQuestionFileUploader,
    type ExerciseQuestionVideoRecordingUploader,
    validateTextareaAnswer
  } from '@cio/question-types';
  import type { AssessmentDeliveryDefinition, AssessmentResponseEnvelope } from '@cio/question-types';
  import { exerciseApi } from '$features/course/api';
  import type {
    Exercise,
    ExerciseAttempt,
    SubmissionListItem,
    SubmittedExerciseAttempt
  } from '$features/course/utils/types';
  import { SafeHtmlContent } from '@cio/ui/custom/safe-html-content';
  import { t } from '$lib/utils/functions/translations';
  import { snackbar } from '$features/ui/snackbar/store';
  import { toggleConfetti } from '$features/ui/confetti/store';
  import { ContentType } from '@cio/utils/constants/content';
  import { getOrderedNavigableContent } from '$features/course/utils/content';
  import { isOrgStudent } from '$lib/utils/store/app';
  import {
    openCourseCompletionModal,
    updateCourseCompletionModal,
    closeCourseCompletionModal
  } from '$features/course/store/course-completion-modal';
  import { isSelfPacedLikeCourse } from '$features/course/utils/compliance-utils';
  import { toExerciseQuestionModel } from './question-type-utils';
  import { getAssessmentPassageWorkspaceLabels, getExerciseQuestionLabels } from './question-labels';
  import {
    getExerciseSectionDisplayHtml,
    getExerciseSectionDisplayTitle
  } from '$features/course/utils/exercise-section-utils';
  import {
    formatExercisePoints,
    orderExerciseItemsBySections,
    roundExercisePointsForDisplay,
    shouldCompleteExerciseFromSubmission
  } from '$features/course/utils/exercise-progression-utils';
  import axios from 'axios';
  import { IconButton } from '@cio/ui/custom/icon-button';
  import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import type { Question } from '$features/course/types';
  import { getResolvedUploadLimits } from '$lib/utils/config/upload-limits-context';
  import {
    parseExerciseAutosave,
    shouldHydrateHistoricalSubmission
  } from '$features/course/utils/exercise-autosave-utils';
  import {
    getLearnerSectionQuestionDisplayStorageKey,
    resolveLearnerSectionQuestionDisplay,
    type LearnerSectionQuestionDisplay
  } from '$features/course/utils/exercise-section-display-mode';
  import {
    getCanonicalAssessmentReviewItems,
    sumAnswerScoresForRenderedQuestions,
    type CanonicalAssessmentReviewItem
  } from '$features/course/utils/submission-review-score-utils';
  import { VIDEO_RECORDING_MIME_TYPES, type TExerciseVideoRecordingUploadInit } from '@cio/utils/validation/exercise';
  import type { TExerciseSubmissionCreate } from '@cio/utils/validation/exercise';

  type CanonicalQuestion = NonNullable<Exercise['canonicalQuestions']>[number];
  type TakeItem =
    | { kind: 'legacy'; id: string; question: Question }
    | {
        kind: 'canonical';
        id: string;
        question: CanonicalQuestion;
        definition: AssessmentDeliveryDefinition;
        feedback?: CanonicalAssessmentReviewItem['feedback'];
        revisionId: string | null;
      };

  interface Props {
    preview?: boolean;
    exerciseId?: string;
    isFetchingExercise?: boolean;
    /** Current user's submissions (ordered by attempt) */
    mySubmissions?: SubmissionListItem[];
  }

  let { preview = false, exerciseId = '', isFetchingExercise = false, mySubmissions = [] }: Props = $props();

  const uploadLimits = getResolvedUploadLimits();
  const platformMaxFileSizeMb = uploadLimits.exerciseFileMb;

  function isSupportedVideoRecordingMimeType(value: string): value is TExerciseVideoRecordingUploadInit['mimeType'] {
    return VIDEO_RECORDING_MIME_TYPES.some((mimeType) => mimeType === value);
  }

  let isSubmitting = $state(false);
  /** When true, do not re-apply a past submission over a fresh take (Try again). */
  let skipHydrateFromSubmissions = $state(false);
  let hasRestoredUnfinishedDraft = $state(false);
  let isLoadingAutoSavedData = $state(false);
  let alreadyCheckedAutoSavedData = $state(false);
  let prevExerciseId = $state('');
  let slideDirection = $state<'next' | 'prev'>('next');
  let selectedTryIndex = $state(-1);
  let learnerSectionQuestionDisplay = $state<LearnerSectionQuestionDisplay>('one_question');
  let learnerSectionQuestionDisplayExerciseId = $state('');
  let draftSaveTimer: ReturnType<typeof setTimeout> | undefined;
  const questionLabels = $derived(getExerciseQuestionLabels());
  const passageWorkspaceLabels = $derived(getAssessmentPassageWorkspaceLabels());
  const sectionFallbackTitle = $derived($t('course.navItem.lessons.exercises.all_exercises.section.fallback_title'));

  /** Submissions created in this session — the `mySubmissions` prop only refreshes on page load. */
  let localSubmissions = $state<SubmittedExerciseAttempt[]>([]);
  let canonicalDefinitionsByQuestionId = $state<Record<string, AssessmentDeliveryDefinition>>({});
  let loadedCanonicalRevisionIdsByQuestionId = $state<Record<string, string>>({});
  let reviewedCanonicalTakeItems = $state<Array<Extract<TakeItem, { kind: 'canonical' }>>>([]);
  let isLoadingCanonicalItems = $state(false);
  let canonicalItemsLoadFailed = $state(false);
  let loadedCanonicalExerciseId = $state('');
  let canonicalValidationQuestionId = $state<string | null>(null);
  let canonicalFocusRequestKey = $state(0);

  const submissionList = $derived.by(() => {
    const loadedSubmissions = Array.isArray(mySubmissions) ? mySubmissions : [];
    const newSubmissions = localSubmissions.filter(
      (localSubmission) => !loadedSubmissions.some((loadedSubmission) => loadedSubmission.id === localSubmission.id)
    );
    return [...loadedSubmissions, ...newSubmissions];
  });

  /** Attempt currently shown: -1 means "latest" (e.g. right after submitting). */
  const viewedAttemptIndex = $derived(selectedTryIndex >= 0 ? selectedTryIndex : submissionList.length - 1);

  function saveCurrentExerciseDraft() {
    if (!exerciseId) return;

    if (draftSaveTimer) {
      clearTimeout(draftSaveTimer);
      draftSaveTimer = undefined;
    }

    try {
      const currentMetadata = get(questionnaireMetaData);
      localStorage.setItem(`autosave-exercise-${exerciseId}`, JSON.stringify(currentMetadata));
    } catch (error) {
      console.error('Failed to autosave exercise data', { exerciseId, error });
    }
  }

  function scheduleExerciseDraftSave() {
    if (draftSaveTimer) clearTimeout(draftSaveTimer);

    draftSaveTimer = setTimeout(() => {
      draftSaveTimer = undefined;
      saveCurrentExerciseDraft();
    }, 300);
  }

  onDestroy(() => {
    if (draftSaveTimer) saveCurrentExerciseDraft();
  });

  function handleStart() {
    questionnaireMetaData.update((m) => ({
      ...m,
      currentQuestionIndex: 1,
      currentSectionIndex: 0,
      sectionPhase: hasSectionedExercise ? 'overview' : 'questions'
    }));
    saveCurrentExerciseDraft();
  }

  function normalizeAnswerValue(
    previousValue: AnswerData | undefined,
    nextValue: AnswerData | undefined
  ): AnswerData | undefined {
    if (nextValue && typeof nextValue === 'object' && 'type' in nextValue) {
      return nextValue;
    }
    return previousValue;
  }

  function mapAnswerToApiPayload(question: Question, answerData: AnswerData | null | undefined): ApiPayload | null {
    const questionId = Number(question.id);
    if (Number.isNaN(questionId) || !answerData) return null;
    return toApiPayload(answerData, questionId);
  }

  function hasMeaningfulCanonicalResponse(response: AssessmentResponseEnvelope | undefined): boolean {
    return (response?.responses.length ?? 0) > 0;
  }

  function isCanonicalTakeItemAnswered(
    item: Extract<TakeItem, { kind: 'canonical' }>,
    response: AssessmentResponseEnvelope | undefined
  ): boolean {
    return (
      hasMeaningfulCanonicalResponse(response) && isAssessmentVerticalSliceResponseComplete(item.definition, response)
    );
  }

  function getTakeItemQuestionProgress(item: TakeItem): { answered: number; total: number } {
    if (item.kind === 'canonical') {
      return getAssessmentVerticalSliceResponseProgress(
        item.definition,
        $questionnaireMetaData.canonicalAnswers[item.id]
      );
    }

    const questionKey = getExerciseQuestionContractKey(toExerciseQuestionModel(item.question));
    const answered = hasMeaningfulAnswerData($questionnaireMetaData.answers[questionKey]) ? 1 : 0;

    return { answered, total: 1 };
  }

  function getExerciseQuestionProgress(items: TakeItem[]): { answered: number; total: number } {
    return items.reduce(
      (progress, item) => {
        const itemProgress = getTakeItemQuestionProgress(item);

        return {
          answered: progress.answered + itemProgress.answered,
          total: progress.total + itemProgress.total
        };
      },
      { answered: 0, total: 0 }
    );
  }

  function getTakeItemPoints(item: TakeItem): number {
    if (item.kind === 'legacy') return getTotalPossibleGrade([item.question]);

    return item.definition.blocks.reduce((total, block) => {
      return block.kind === 'interaction' ? total + block.interaction.maxScore : total;
    }, 0);
  }

  function isRequiredTakeItem(item: TakeItem): boolean {
    if (item.kind === 'legacy') return isRequiredQuestion(item.question);

    return item.definition.blocks.some((block) => block.kind === 'interaction' && block.interaction.required);
  }

  function isRequiredQuestion(question: Question | null | undefined): boolean {
    return !question || toExerciseQuestionModel(question).required !== false;
  }

  async function submitExercise() {
    if (!courseApi.course?.id || isSubmitting) return;

    saveCurrentExerciseDraft();
    isSubmitting = true;

    try {
      const updated = get(questionnaireMetaData);
      const totalPossibleGrade = getTakeItemTotalPossibleGrade(allTakeItems);
      const idempotencyStorageKey = `exercise-submission-idempotency-${exerciseId}`;
      const idempotencyKey = localStorage.getItem(idempotencyStorageKey) ?? crypto.randomUUID();
      localStorage.setItem(idempotencyStorageKey, idempotencyKey);

      const legacyAnswersForApi = Object.entries(updated.answers)
        .map(([questionKey, val]) => {
          const question = $questionnaire.questions.find(
            (item) => getExerciseQuestionContractKey(toExerciseQuestionModel(item)) === questionKey
          );
          if (!question) return null;
          return mapAnswerToApiPayload(question, val);
        })
        .filter((answer): answer is ApiPayload => answer !== null);

      const canonicalAnswersForApi: TExerciseSubmissionCreate['answers'] = [];
      for (const item of canonicalTakeItems) {
        const questionRevisionId = updated.canonicalRevisionIds[item.id] ?? item.revisionId;
        if (!questionRevisionId) {
          console.error(`Assessment question "${item.id}" has no delivered revision`);
          snackbar.error();
          return;
        }

        canonicalAnswersForApi.push({
          questionId: Number(item.question.id),
          questionRevisionId,
          response: updated.canonicalAnswers[item.id] ?? { schemaVersion: 1, responses: [] }
        });
      }

      const answersForApi: TExerciseSubmissionCreate['answers'] = [...legacyAnswersForApi, ...canonicalAnswersForApi];

      if (answersForApi.length === 0 && allTakeItems.some(isRequiredTakeItem)) {
        snackbar.error(t.get('course.navItem.lessons.exercises.all_exercises.view_mode.answers_required'));
        return;
      }

      const submitResult = await exerciseApi.submit(courseApi.course.id, exerciseId, answersForApi, idempotencyKey);

      if (exerciseApi.success && submitResult?.data) {
        localStorage.removeItem(`autosave-exercise-${exerciseId}`);
        localStorage.removeItem(idempotencyStorageKey);
        skipHydrateFromSubmissions = false;
        hasRestoredUnfinishedDraft = false;
        const sub = submitResult.data;
        if (sub.gradingState === 'completed' && sub.statusId === STATUS.GRADED && Array.isArray(sub.answers)) {
          const overviewResult = await exerciseApi.getSubmissions(courseApi.course.id, exerciseId);
          const reviewedSubmission = overviewResult?.data?.mySubmission.find((submission) => submission.id === sub.id);
          if (!reviewedSubmission) {
            console.error('Submitted exercise review projection could not be loaded', {
              exerciseId,
              submissionId: sub.id
            });
            snackbar.error();
            await invalidateAll();
            return;
          }

          localSubmissions = [...localSubmissions, reviewedSubmission];
          selectedTryIndex = submissionList.length - 1;
          applyMySubmission(reviewedSubmission);
        } else {
          localSubmissions = [...localSubmissions, sub];
          selectedTryIndex = submissionList.length - 1;
          questionnaireMetaData.update((m) => ({
            ...m,
            status: 1,
            totalPossibleGrade,
            grades: {},
            comment: '',
            isFinished: true,
            exerciseId
          }));
        }
        const shouldMarkComplete = shouldCompleteExerciseFromSubmission({
          completionPolicy: $questionnaire.completionPolicy,
          passThreshold: $questionnaire.passThreshold,
          totalPossiblePoints: totalPossibleGrade,
          submission: sub
        });

        courseApi.updateContentItem(exerciseId, ContentType.Exercise, { isComplete: shouldMarkComplete });

        if (shouldMarkComplete) {
          toggleConfetti();
          setTimeout(toggleConfetti, 3000);
        }

        const allContentItems = getOrderedNavigableContent(courseApi.course);
        const allComplete =
          shouldMarkComplete &&
          $isOrgStudent &&
          allContentItems.length > 0 &&
          allContentItems.every((item) => item.isComplete);

        if (allComplete && courseApi.course?.id) {
          const requiredExerciseId = courseApi.course?.certificate?.requiredExerciseId ?? undefined;
          openCourseCompletionModal(courseApi.course.id);

          const certRes = await courseApi.getCertificationEvaluation(courseApi.course.id);
          if (certRes?.data) {
            const hasCompletedCourse = Boolean(certRes.data.eligibleForCertificate || certRes.data.certificateEarnedAt);
            updateCourseCompletionModal(
              courseApi.course.id,
              hasCompletedCourse ? 'eligible' : 'not-eligible',
              certRes.data,
              requiredExerciseId
            );
          } else {
            closeCourseCompletionModal();
          }
        }
      }
    } finally {
      isSubmitting = false;
    }
  }

  function evaluateSectionAfterBehavior() {
    if (!currentSection) return;

    const behavior = currentSection.afterBehavior;
    if (behavior.action === 'submit') {
      submitExercise();
      return;
    }

    if (behavior.action === 'go_to_section' && behavior.exerciseSectionId) {
      const targetIndex = activeSections.findIndex((section) => section.id === behavior.exerciseSectionId);
      if (targetIndex >= 0) {
        questionnaireMetaData.update((m) => ({
          ...m,
          currentSectionIndex: targetIndex,
          currentQuestionIndex: 1,
          sectionPhase: 'overview'
        }));
        saveCurrentExerciseDraft();
        return;
      }
    }

    const nextSectionIndex = $questionnaireMetaData.currentSectionIndex + 1;
    if (nextSectionIndex < activeSections.length) {
      questionnaireMetaData.update((m) => ({
        ...m,
        currentSectionIndex: nextSectionIndex,
        currentQuestionIndex: 1,
        sectionPhase: 'overview'
      }));
      saveCurrentExerciseDraft();
      return;
    }

    submitExercise();
  }

  async function onSubmit(id: string, value: AnswerData | undefined) {
    if (!courseApi.course?.id) return;

    const { answers } = $questionnaireMetaData;
    const questions = hasSectionedExercise ? currentSectionQuestions : $questionnaire.questions;
    const prevAnswer = answers[id];
    const formattedAnswer = normalizeAnswerValue(prevAnswer, value);
    const question = questions.find((item) => getExerciseQuestionContractKey(toExerciseQuestionModel(item)) === id);
    if (!question) return;

    const hasAnswer = hasMeaningfulAnswerData(formattedAnswer);
    if (!hasAnswer && isRequiredQuestion(question)) {
      snackbar.error(t.get('course.navItem.lessons.exercises.all_exercises.view_mode.answer_required'));
      return;
    }

    if (hasAnswer && !mapAnswerToApiPayload(question, formattedAnswer)) {
      snackbar.error(t.get('course.navItem.lessons.exercises.all_exercises.view_mode.answer_required'));
      return;
    }

    const newAnswers = { ...answers };
    if (formattedAnswer) {
      newAnswers[id] = formattedAnswer;
    } else {
      delete newAnswers[id];
    }
    questionnaireMetaData.update((m) => ({ ...m, answers: newAnswers }));
    saveCurrentExerciseDraft();

    const currentIndex = $questionnaireMetaData.currentQuestionIndex;
    const isLastQuestion = currentIndex === currentTakeItemList.length;

    if (isLastQuestion) {
      if (hasSectionedExercise) {
        evaluateSectionAfterBehavior();
      } else {
        await submitExercise();
      }
    } else {
      // Advance to next question
      slideDirection = 'next';
      questionnaireMetaData.update((m) => ({ ...m, currentQuestionIndex: m.currentQuestionIndex + 1 }));
      saveCurrentExerciseDraft();
    }
  }

  function onCanonicalResponseChange(questionId: string, response: AssessmentResponseEnvelope) {
    questionnaireMetaData.update((metaData) => ({
      ...metaData,
      canonicalAnswers: {
        ...metaData.canonicalAnswers,
        [questionId]: response
      }
    }));
    const item = canonicalTakeItems.find((takeItem) => takeItem.id === questionId);
    if (
      canonicalValidationQuestionId === questionId &&
      item &&
      isAssessmentVerticalSliceResponseComplete(item.definition, response)
    ) {
      canonicalValidationQuestionId = null;
    }
    scheduleExerciseDraftSave();
  }

  function getCanonicalQuestionElementId(questionId: string): string {
    return `canonical-question-${questionId}`;
  }

  async function focusFirstInvalidCanonicalInteraction(item: Extract<TakeItem, { kind: 'canonical' }>) {
    canonicalFocusRequestKey += 1;
    canonicalValidationQuestionId = item.id;
    await tick();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const questionElement = document.getElementById(getCanonicalQuestionElementId(item.id));
      const invalidControlSelectors = [
        '[data-assessment-invalid="true"] textarea',
        '[data-assessment-invalid="true"] [contenteditable="true"]',
        '[data-assessment-invalid="true"] input:not([disabled])',
        '[data-assessment-invalid="true"] button:not([disabled])'
      ];
      const invalidInteraction = questionElement?.querySelector<HTMLElement>('[data-assessment-invalid="true"]');
      const invalidControl = invalidControlSelectors
        .map((selector) => invalidInteraction?.querySelector<HTMLElement>(selector))
        .find((control): control is HTMLElement => control !== null && control !== undefined);
      invalidControl?.focus();
      if (invalidControl && document.activeElement === invalidControl) return;
    }
  }

  async function onCanonicalNext(item: Extract<TakeItem, { kind: 'canonical' }>) {
    const response = $questionnaireMetaData.canonicalAnswers[item.id];
    if (!isAssessmentVerticalSliceResponseComplete(item.definition, response)) {
      snackbar.error(t.get('course.navItem.lessons.exercises.all_exercises.view_mode.answer_required'));
      await focusFirstInvalidCanonicalInteraction(item);
      return;
    }

    canonicalValidationQuestionId = null;
    const isLastQuestion = $questionnaireMetaData.currentQuestionIndex === currentTakeItemList.length;
    if (isLastQuestion) {
      if (hasSectionedExercise) {
        evaluateSectionAfterBehavior();
      } else {
        submitExercise();
      }
      return;
    }

    slideDirection = 'next';
    questionnaireMetaData.update((metaData) => ({
      ...metaData,
      currentQuestionIndex: metaData.currentQuestionIndex + 1
    }));
    saveCurrentExerciseDraft();
  }

  function onPrevious() {
    if (hasSectionedExercise && $questionnaireMetaData.currentQuestionIndex <= 1) {
      questionnaireMetaData.update((m) => ({ ...m, sectionPhase: 'overview' }));
      return;
    }

    slideDirection = 'prev';
    questionnaireMetaData.update((m) => ({ ...m, currentQuestionIndex: m.currentQuestionIndex - 1 }));
    saveCurrentExerciseDraft();
  }

  function getProgressValue() {
    if ($questionnaireMetaData.isFinished) {
      return 100;
    }

    const questionProgress = getExerciseQuestionProgress(allTakeItems);
    if (questionProgress.total === 0) return 0;

    return Math.round((questionProgress.answered / questionProgress.total) * 100);
  }

  function getTotalPossibleGrade(questions: Question[]): number {
    return questions.reduce((total, question) => total + Number(question.points ?? 0), 0);
  }

  function getTakeItemTotalPossibleGrade(items: TakeItem[]): number {
    return items.reduce((total, item) => total + getTakeItemPoints(item), 0);
  }

  function formatPercent(value: number) {
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 1
    }).format(value);
  }

  function getAutoSavedData() {
    isLoadingAutoSavedData = true;
    hasRestoredUnfinishedDraft = false;

    try {
      const storageKey = `autosave-exercise-${exerciseId}`;
      const stringifiedQuestionnaireMetaData = localStorage.getItem(storageKey);

      if (stringifiedQuestionnaireMetaData) {
        const questions = $questionnaire.questions.map(toExerciseQuestionModel);
        const activeSectionCount = $questionnaire.sections.filter((section) => !section.deletedAt).length;
        const canonicalQuestionIds = new Set($questionnaire.canonicalQuestions.map((question) => String(question.id)));
        const canonicalQuestionRevisionIds = Object.fromEntries(
          $questionnaire.canonicalQuestions.map((question) => [String(question.id), question.revisionId])
        );
        const activeLegacyQuestionCount = $questionnaire.questions.filter((question) => !question.deletedAt).length;
        const takeItemCount = activeLegacyQuestionCount + $questionnaire.canonicalQuestions.length;
        const autoSavedData = parseExerciseAutosave({
          serializedValue: stringifiedQuestionnaireMetaData,
          exerciseId,
          questions,
          sectionCount: activeSectionCount,
          canonicalQuestionIds,
          canonicalQuestionRevisionIds,
          takeItemCount
        });
        if (autoSavedData) {
          questionnaireMetaData.set(autoSavedData);
          hasRestoredUnfinishedDraft = !autoSavedData.isFinished;
        } else {
          localStorage.removeItem(storageKey);
          console.warn('Removed invalid autosaved exercise data', { exerciseId });
        }
      }
    } catch (error) {
      console.error('Failed to restore autosaved exercise data', { exerciseId, error });
    } finally {
      isLoadingAutoSavedData = false;
      alreadyCheckedAutoSavedData = true;
    }
  }

  const handleFileUpload: ExerciseQuestionFileUploader = async ({ questionId, file }) => {
    if (!courseApi.course?.id || !exerciseId) {
      throw new Error('Exercise is not ready for upload');
    }

    const mimeType = resolveCanonicalFileUploadMimeType({ fileName: file.name, mimeType: file.type });
    if (!mimeType) {
      throw new Error('Unsupported file type');
    }

    const initResult = await exerciseApi.initExerciseFileUpload(courseApi.course.id, exerciseId, questionId, {
      fileName: file.name,
      mimeType,
      size: file.size
    });
    if (!initResult?.data) {
      throw new Error('Failed to get upload URL');
    }

    await axios.put(initResult.data.uploadUrl, file, {
      headers: { 'Content-Type': mimeType },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    const completeResult = await exerciseApi.completeExerciseFileUpload(courseApi.course.id, exerciseId, questionId, {
      assetId: initResult.data.assetId,
      storageKey: initResult.data.storageKey
    });
    if (!completeResult?.data) {
      throw new Error('Failed to complete upload');
    }

    return completeResult.data;
  };

  const handleVideoRecordingUpload: ExerciseQuestionVideoRecordingUploader = async (input) => {
    if (!courseApi.course?.id || !exerciseId) {
      throw new Error('Exercise is not ready for upload');
    }
    if (!isSupportedVideoRecordingMimeType(input.mimeType)) {
      throw new Error('Unsupported recording format');
    }
    const mimeType: TExerciseVideoRecordingUploadInit['mimeType'] = input.mimeType;

    const initResult = await exerciseApi.initVideoRecordingUpload(courseApi.course.id, exerciseId, input.questionId, {
      fileName: input.fileName,
      mimeType,
      size: input.size
    });
    if (!initResult?.data) {
      throw new Error('Failed to get upload URL');
    }

    await axios.put(initResult.data.uploadUrl, input.blob, {
      headers: { 'Content-Type': input.mimeType },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    const completeResult = await exerciseApi.completeVideoRecordingUpload(
      courseApi.course.id,
      exerciseId,
      input.questionId,
      {
        assetId: initResult.data.assetId,
        storageKey: initResult.data.storageKey,
        fileName: input.fileName,
        mimeType,
        size: input.size,
        durationSeconds: input.durationSeconds,
        recordedAt: input.recordedAt,
        retakeCount: input.retakeCount
      }
    );
    if (!completeResult?.data) {
      throw new Error('Failed to complete upload');
    }

    return completeResult.data;
  };

  function onSharedAnswerChange(answerValue: AnswerData | null) {
    if (!sharedCurrentQuestionKey) return;

    questionnaireMetaData.update((metaData) => {
      const answers = { ...metaData.answers };
      if (answerValue === null) {
        delete answers[sharedCurrentQuestionKey];
      } else {
        answers[sharedCurrentQuestionKey] = answerValue;
      }

      return {
        ...metaData,
        answers
      };
    });
    scheduleExerciseDraftSave();
  }

  function onSharedNext(valueOverride?: AnswerData) {
    if (!sharedCurrentQuestionKey) return;
    const valueToUse = valueOverride !== undefined ? valueOverride : sharedCurrentAnswer;
    if (!hasMeaningfulAnswerData(valueToUse) && isRequiredQuestion(currentQuestion)) {
      snackbar.error(t.get('course.navItem.lessons.exercises.all_exercises.view_mode.answer_required'));
      return;
    }

    const textareaError = getTextareaValidationError(valueToUse);
    if (textareaError) {
      snackbar.error(textareaError);
      return;
    }

    onSubmit(sharedCurrentQuestionKey, valueToUse);
  }

  function beginCurrentSection() {
    questionnaireMetaData.update((m) => ({
      ...m,
      currentQuestionIndex: 1,
      sectionPhase: 'questions'
    }));
    saveCurrentExerciseDraft();
  }

  function goBackFromSectionOverview() {
    if ($questionnaireMetaData.currentSectionIndex <= 0) {
      questionnaireMetaData.update((m) => ({
        ...m,
        currentQuestionIndex: 0,
        sectionPhase: 'overview'
      }));
      saveCurrentExerciseDraft();
      return;
    }

    questionnaireMetaData.update((m) => ({
      ...m,
      currentSectionIndex: m.currentSectionIndex - 1,
      currentQuestionIndex: 1,
      sectionPhase: 'overview'
    }));
    saveCurrentExerciseDraft();
  }

  function onSectionQuestionAnswerChange(question: Question, answerValue: AnswerData) {
    const questionKey = getExerciseQuestionContractKey(toExerciseQuestionModel(question));
    questionnaireMetaData.update((metaData) => ({
      ...metaData,
      answers: {
        ...metaData.answers,
        [questionKey]: answerValue
      }
    }));
    scheduleExerciseDraftSave();
  }

  async function completeAllQuestionsSection() {
    const missingAnswer = currentSectionTakeItems.find((item) => {
      if (item.kind === 'canonical') {
        return !isAssessmentVerticalSliceResponseComplete(
          item.definition,
          $questionnaireMetaData.canonicalAnswers[item.id]
        );
      }

      if (!isRequiredTakeItem(item)) return false;

      const questionKey = getExerciseQuestionContractKey(toExerciseQuestionModel(item.question));
      return !hasMeaningfulAnswerData($questionnaireMetaData.answers[questionKey]);
    });

    if (missingAnswer) {
      snackbar.error(t.get('course.navItem.lessons.exercises.all_exercises.view_mode.answer_required'));
      if (missingAnswer.kind === 'canonical') {
        await focusFirstInvalidCanonicalInteraction(missingAnswer);
      }
      return;
    }

    evaluateSectionAfterBehavior();
  }

  function handleEnterKey(e: KeyboardEvent) {
    if (hasSectionedExercise && resolvedSectionQuestionDisplay === 'all_questions') return;
    if (e.key !== 'Enter' || isSubmitting || !currentQuestion) return;

    const target = e.target as HTMLElement;
    if (target?.tagName === 'TEXTAREA' || isTextEditorTarget(target)) return;

    e.preventDefault();

    let valueToUse: AnswerData | undefined = sharedCurrentAnswer as AnswerData | undefined;

    if (target instanceof HTMLInputElement && sharedQuestionModel) {
      const questionTypeKey = sharedQuestionModel.questionType;
      const trimmed = target.value?.trim() ?? '';

      if (questionTypeKey === 'SHORT_ANSWER' && trimmed) {
        valueToUse = { type: 'SHORT_ANSWER', text: trimmed };
        onSharedAnswerChange(valueToUse);
      } else if (questionTypeKey === 'NUMERIC' && trimmed) {
        const num = Number(trimmed);
        valueToUse = !Number.isNaN(num) ? { type: 'NUMERIC', value: num } : undefined;

        if (valueToUse) onSharedAnswerChange(valueToUse);
      }
    }
    if (!hasMeaningfulAnswerData(valueToUse) && isRequiredQuestion(currentQuestion)) {
      snackbar.error($t('course.navItem.lessons.exercises.all_exercises.view_mode.answer_required'));
      return;
    }
    onSharedNext(valueToUse);
  }

  function isTextEditorTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;

    if (target.isContentEditable) return true;

    return target.closest('[contenteditable="true"], .ProseMirror') !== null;
  }

  function getTextareaValidationError(answerValue: AnswerData | null | undefined): string | null {
    if (!sharedQuestionModel || !answerValue || answerValue.type !== 'TEXTAREA') return null;

    const validation = validateTextareaAnswer(answerValue.text, sharedQuestionModel);
    if (validation.isValid) return null;

    if (validation.minCharacters !== undefined && validation.maxCharacters !== undefined) {
      return t.get('course.navItem.lessons.exercises.all_exercises.shared_question.textarea.take.range_error', {
        min: validation.minCharacters,
        max: validation.maxCharacters
      });
    }

    if (validation.reason === 'below_min' && validation.minCharacters !== undefined) {
      return t.get('course.navItem.lessons.exercises.all_exercises.shared_question.textarea.take.min_error', {
        min: validation.minCharacters
      });
    }

    if (validation.reason === 'above_max' && validation.maxCharacters !== undefined) {
      return t.get('course.navItem.lessons.exercises.all_exercises.shared_question.textarea.take.max_error', {
        max: validation.maxCharacters
      });
    }

    return null;
  }

  $effect(() => {
    if (
      !exerciseId ||
      isFetchingExercise ||
      ($questionnaire.questions.length === 0 && $questionnaire.canonicalQuestions.length === 0)
    ) {
      return;
    }
    if (alreadyCheckedAutoSavedData) return;

    getAutoSavedData();
  });

  $effect(() => {
    if (loadedCanonicalExerciseId && loadedCanonicalExerciseId !== exerciseId) {
      loadedCanonicalExerciseId = '';
      canonicalDefinitionsByQuestionId = {};
      loadedCanonicalRevisionIdsByQuestionId = {};
      isLoadingCanonicalItems = false;
    }
    if (!courseApi.course?.id || !exerciseId || isFetchingExercise) return;
    if ($questionnaireMetaData.exerciseId !== exerciseId) return;
    if (loadedCanonicalExerciseId === exerciseId) return;

    const canonicalQuestions = $questionnaire.canonicalQuestions;
    loadedCanonicalExerciseId = exerciseId;
    canonicalDefinitionsByQuestionId = {};
    loadedCanonicalRevisionIdsByQuestionId = {};
    canonicalItemsLoadFailed = false;
    if (canonicalQuestions.length === 0) return;

    isLoadingCanonicalItems = true;
    try {
      const entries = canonicalQuestions.map((question) => {
        const deliveryDefinition = parseAssessmentDeliveryDefinition(question.definition);
        if (!deliveryDefinition.success) {
          throw new Error(`Assessment question ${question.id} has an invalid delivery definition`);
        }

        return [String(question.id), deliveryDefinition.data, question.revisionId] as const;
      });

      canonicalDefinitionsByQuestionId = Object.fromEntries(
        entries.map(([questionId, definition]) => [questionId, definition])
      );
      loadedCanonicalRevisionIdsByQuestionId = Object.fromEntries(
        entries.map(([questionId, , revisionId]) => [questionId, revisionId])
      );
      questionnaireMetaData.update((metaData) => ({
        ...metaData,
        canonicalRevisionIds: {
          ...loadedCanonicalRevisionIdsByQuestionId,
          ...metaData.canonicalRevisionIds
        }
      }));
    } catch (error) {
      console.error('Failed to load assessment questions from the exercise response', { exerciseId, error });
      canonicalItemsLoadFailed = true;
    } finally {
      isLoadingCanonicalItems = false;
    }
  });

  function retryLoadingCanonicalItems() {
    loadedCanonicalExerciseId = '';
    canonicalItemsLoadFailed = false;
  }

  const progressValue = $derived(getProgressValue());
  const activeSections = $derived(
    [...($questionnaire.sections ?? [])].filter((section) => !section.deletedAt).sort((a, b) => a.order - b.order)
  );
  const hasSectionedExercise = $derived(hasSections($questionnaire.sections ?? []));
  const resolvedSectionQuestionDisplay = $derived(
    resolveLearnerSectionQuestionDisplay($questionnaire.sectionDisplayMode, learnerSectionQuestionDisplay)
  );
  const currentSection = $derived(
    hasSectionedExercise ? activeSections[$questionnaireMetaData.currentSectionIndex] : null
  );
  const currentSectionQuestions = $derived(
    currentSection ? getQuestionsForSection($questionnaire.questions, currentSection.id) : []
  );
  const legacyTakeItems = $derived(
    $questionnaire.questions
      .filter((question) => !question.deletedAt)
      .map((question) => ({ kind: 'legacy' as const, id: String(question.id), question }))
  );
  const persistedCanonicalTakeItems = $derived(
    $questionnaire.canonicalQuestions.flatMap((question) => {
      const questionId = String(question.id);
      const definition = canonicalDefinitionsByQuestionId[questionId];
      const revisionId = loadedCanonicalRevisionIdsByQuestionId[questionId] ?? null;
      return definition ? [{ kind: 'canonical' as const, id: questionId, question, definition, revisionId }] : [];
    })
  );
  const canonicalTakeItems = $derived.by(() => {
    if (!preview) return persistedCanonicalTakeItems;

    const previewEntries = Object.entries($assessmentComposerPreviewItems).filter(
      ([, item]) => item.exerciseId === exerciseId
    );
    const previewItemsByQuestionId = new Map(
      previewEntries.flatMap(([, item]) => (item.questionId === null ? [] : [[String(item.questionId), item] as const]))
    );
    const persistedItems = persistedCanonicalTakeItems.map((item) => {
      const previewItem = previewItemsByQuestionId.get(item.id);
      if (!previewItem) return item;

      return {
        ...item,
        question: {
          ...item.question,
          title: previewItem.title,
          points: previewItem.points,
          gradingMode: previewItem.gradingMode
        },
        definition: previewItem.definition,
        revisionId: item.revisionId
      };
    });
    const newDraftItems = previewEntries.flatMap(([composerId, item], draftIndex) => {
      if (item.questionId !== null || item.definition.blocks.length === 0) return [];

      const question: CanonicalQuestion = {
        id: -(draftIndex + 1),
        title: item.title,
        points: item.points,
        order: item.order,
        exerciseSectionId: item.exerciseSectionId,
        gradingMode: item.gradingMode
      };

      return [
        {
          kind: 'canonical' as const,
          id: `draft:${composerId}`,
          question,
          definition: item.definition,
          revisionId: null
        }
      ];
    });

    return [...persistedItems, ...newDraftItems];
  });
  const allTakeItems = $derived(
    orderExerciseItemsBySections([...legacyTakeItems, ...canonicalTakeItems], activeSections)
  );
  const exerciseQuestionProgress = $derived(getExerciseQuestionProgress(allTakeItems));
  const interactionNumberStartByItemId = $derived.by(() => {
    const numberStartByItemId: Record<string, number> = {};
    let nextQuestionNumber = 1;

    for (const item of allTakeItems) {
      numberStartByItemId[item.id] = nextQuestionNumber;
      nextQuestionNumber += getTakeItemQuestionProgress(item).total;
    }

    return numberStartByItemId;
  });
  const currentSectionTakeItems = $derived(
    currentSection ? allTakeItems.filter((item) => item.question.exerciseSectionId === currentSection.id) : []
  );
  const currentSectionQuestionCount = $derived(getExerciseQuestionProgress(currentSectionTakeItems).total);
  const currentSectionDisplayHtml = $derived(
    currentSection
      ? getExerciseSectionDisplayHtml({
          title: currentSection.title,
          sectionNumber: $questionnaireMetaData.currentSectionIndex + 1,
          sectionLabel: sectionFallbackTitle
        })
      : ''
  );
  const currentTakeItemList = $derived(hasSectionedExercise ? currentSectionTakeItems : allTakeItems);
  const currentTakeItem = $derived(currentTakeItemList[$questionnaireMetaData.currentQuestionIndex - 1]);
  const currentQuestion = $derived(currentTakeItem?.kind === 'legacy' ? currentTakeItem.question : null);
  const isExerciseLoaded = $derived(alreadyCheckedAutoSavedData && allTakeItems.length > 0 && !isLoadingCanonicalItems);
  const isFinished = $derived(
    isExerciseLoaded &&
      $questionnaireMetaData.currentQuestionIndex > 0 &&
      !currentTakeItem &&
      (!hasSectionedExercise || $questionnaireMetaData.isFinished)
  );
  const sharedQuestionModel = $derived(currentQuestion ? toExerciseQuestionModel(currentQuestion) : null);
  const sharedCurrentQuestionKey = $derived(
    sharedQuestionModel ? getExerciseQuestionContractKey(sharedQuestionModel) : null
  );
  const sharedCurrentAnswer = $derived(
    sharedCurrentQuestionKey ? $questionnaireMetaData.answers[sharedCurrentQuestionKey] : undefined
  );
  const canGoNextForSharedQuestion = $derived(
    !isRequiredQuestion(currentQuestion) || hasMeaningfulAnswerData(sharedCurrentAnswer)
  );
  const canGoNextForCurrentTakeItem = $derived(
    currentTakeItem?.kind === 'canonical'
      ? isAssessmentVerticalSliceResponseComplete(
          currentTakeItem.definition,
          $questionnaireMetaData.canonicalAnswers[currentTakeItem.id]
        )
      : canGoNextForSharedQuestion
  );
  const sectionQuestionTotalPoints = $derived(
    roundExercisePointsForDisplay(getTakeItemTotalPossibleGrade(currentSectionTakeItems))
  );
  const passThresholdPercent = $derived(Number($questionnaire.passThreshold ?? 100));
  const gradedScorePercent = $derived.by(() => {
    const finalGrade = Number($questionnaireMetaData.finalTotalGrade);
    const totalGrade = Number($questionnaireMetaData.totalPossibleGrade);
    if (!Number.isFinite(finalGrade) || !Number.isFinite(totalGrade) || totalGrade <= 0) return null;

    return (finalGrade / totalGrade) * 100;
  });
  const shouldShowPassedCompletionResult = $derived(
    ($questionnaire.completionPolicy ?? 'submitted') === 'passed' &&
      STATUS.GRADED === $questionnaireMetaData.status &&
      gradedScorePercent !== null
  );
  const didCurrentAttemptPass = $derived(
    shouldShowPassedCompletionResult && gradedScorePercent !== null && gradedScorePercent >= passThresholdPercent
  );
  const gradedScorePercentLabel = $derived(gradedScorePercent === null ? '' : formatPercent(gradedScorePercent));
  const passThresholdPercentLabel = $derived(formatPercent(passThresholdPercent));
  const sectionNavigationGroups = $derived(
    activeSections.map((section, sectionIndex) => {
      const sectionItems = allTakeItems.filter((item) => item.question.exerciseSectionId === section.id);
      return {
        id: section.id,
        title: getExerciseSectionDisplayTitle({
          title: section.title,
          sectionNumber: sectionIndex + 1,
          sectionLabel: sectionFallbackTitle
        }),
        isCurrent: currentSection?.id === section.id,
        questions: sectionItems.map((item, questionIndex) => {
          const interactionNumberStart = interactionNumberStartByItemId[item.id] ?? questionIndex + 1;
          const interactionCount = getTakeItemQuestionProgress(item).total;
          const interactionNumberEnd = interactionNumberStart + interactionCount - 1;
          const questionKey =
            item.kind === 'legacy' ? getExerciseQuestionContractKey(toExerciseQuestionModel(item.question)) : item.id;
          const isAnswered =
            item.kind === 'legacy'
              ? hasMeaningfulAnswerData($questionnaireMetaData.answers[questionKey])
              : isCanonicalTakeItemAnswered(item, $questionnaireMetaData.canonicalAnswers[questionKey]);
          return {
            key: questionKey,
            label:
              interactionCount > 1
                ? `Q${interactionNumberStart}-${interactionNumberEnd}`
                : `Q${interactionNumberStart}`,
            isAnswered,
            isCurrent:
              sectionIndex === $questionnaireMetaData.currentSectionIndex &&
              questionIndex === $questionnaireMetaData.currentQuestionIndex - 1 &&
              $questionnaireMetaData.sectionPhase === 'questions'
          };
        })
      };
    })
  );

  const flyX = $derived(slideDirection === 'next' ? 300 : -300);
  const flyOutX = $derived(-flyX);

  $effect(() => {
    if (!exerciseId || learnerSectionQuestionDisplayExerciseId === exerciseId) return;

    let nextDisplay: LearnerSectionQuestionDisplay = 'one_question';
    try {
      const storedDisplay = localStorage.getItem(getLearnerSectionQuestionDisplayStorageKey(exerciseId));
      if (storedDisplay === 'all_questions') nextDisplay = storedDisplay;
    } catch (error) {
      console.error('Failed to restore learner section display preference', { exerciseId, error });
    }

    learnerSectionQuestionDisplay = nextDisplay;
    learnerSectionQuestionDisplayExerciseId = exerciseId;
  });

  function setLearnerSectionQuestionDisplay(display: LearnerSectionQuestionDisplay) {
    learnerSectionQuestionDisplay = display;
    if (!exerciseId) return;

    try {
      localStorage.setItem(getLearnerSectionQuestionDisplayStorageKey(exerciseId), display);
    } catch (error) {
      console.error('Failed to save learner section display preference', { exerciseId, error });
    }
  }

  $effect(() => {
    const finished = isFinished;

    untrack(() => {
      $questionnaireMetaData.isFinished = finished;
    });
  });

  $effect(() => {
    const progress = progressValue;

    untrack(() => {
      $questionnaireMetaData.progressValue = progress;
    });
  });

  $effect(() => {
    if (!exerciseId || isFetchingExercise) return;
    if (
      !shouldHydrateHistoricalSubmission({
        hasRestoredUnfinishedDraft,
        skipHydration: skipHydrateFromSubmissions,
        isExerciseLoaded,
        hasSubmissions: submissionList.length > 0,
        isFinished: $questionnaireMetaData.isFinished
      })
    ) {
      return;
    }

    let idx = selectedTryIndex;
    if (idx < 0 || idx >= submissionList.length) {
      idx = submissionList.length - 1;
      selectedTryIndex = idx;
    }
    const sub = submissionList[idx];
    if (sub) applyMySubmission(sub);
  });

  function goPrevTry() {
    if (viewedAttemptIndex <= 0) return;
    selectedTryIndex = viewedAttemptIndex - 1;
    const sub = submissionList[selectedTryIndex];
    if (sub) applyMySubmission(sub);
  }

  function goNextTry() {
    if (viewedAttemptIndex >= submissionList.length - 1) return;
    selectedTryIndex = viewedAttemptIndex + 1;
    const sub = submissionList[selectedTryIndex];
    if (sub) applyMySubmission(sub);
  }

  function tryAgain() {
    if (!$questionnaire.allowMultipleAttempts) return;
    localStorage.removeItem(`autosave-exercise-${exerciseId}`);
    localStorage.removeItem(`exercise-submission-idempotency-${exerciseId}`);
    selectedTryIndex = -1;
    reviewedCanonicalTakeItems = [];
    canonicalValidationQuestionId = null;
    skipHydrateFromSubmissions = true;
    hasRestoredUnfinishedDraft = false;
    resetStudentExerciseTake();
    questionnaireMetaData.update((metaData) => ({
      ...metaData,
      canonicalRevisionIds: { ...loadedCanonicalRevisionIdsByQuestionId }
    }));
  }

  function applyMySubmission(submission: ExerciseAttempt) {
    const attemptedTakeItems = getTakeItemsForSubmission(submission);
    const totalPossibleGrade = getTakeItemTotalPossibleGrade(attemptedTakeItems);
    // Numerator and denominator share the same rendered question set: answers to
    // questions archived after the attempt are excluded so score never exceeds max.
    const finalTotalGrade = sumAnswerScoresForRenderedQuestions(attemptedTakeItems, submission.answers);
    const grades = (submission.answers ?? []).reduce<Record<string, number>>((acc, answer) => {
      acc[String(answer.questionId)] = answer.score ?? answer.point ?? 0;
      return acc;
    }, {});

    const answers = formatAnswers({
      questions: $questionnaire.questions,
      answers: submission.answers ?? []
    });
    const canonicalAnswers: Record<string, AssessmentResponseEnvelope | undefined> = {};
    const canonicalRevisionIds: Record<string, string> = {};
    for (const answer of submission.answers ?? []) {
      if (!answer.answerData || typeof answer.answerData !== 'object' || !('type' in answer.answerData)) continue;
      if (answer.answerData.type !== 'ASSESSMENT_ITEM') continue;

      const response = assessmentResponseEnvelopeSchema.safeParse(answer.answerData.response);
      if (response.success) canonicalAnswers[String(answer.questionId)] = response.data;
      if (answer.questionRevisionId) canonicalRevisionIds[String(answer.questionId)] = answer.questionRevisionId;
    }

    reviewedCanonicalTakeItems = attemptedTakeItems.filter(
      (item): item is Extract<TakeItem, { kind: 'canonical' }> => item.kind === 'canonical'
    );

    questionnaireMetaData.update((m) => ({
      ...m,
      answers,
      canonicalAnswers,
      canonicalRevisionIds,
      totalPossibleGrade,
      currentQuestionIndex: attemptedTakeItems.length + 1,
      currentSectionIndex: activeSections.length > 0 ? activeSections.length - 1 : 0,
      sectionPhase: 'questions',
      isFinished: true,
      status: submission.statusId ?? STATUS.PENDING,
      finalTotalGrade,
      comment: submission.feedback ?? '',
      grades,
      exerciseId
    }));
  }

  function getTakeItemsForSubmission(submission: ExerciseAttempt): TakeItem[] {
    const canonicalItems = getCanonicalAssessmentReviewItems($questionnaire.canonicalQuestions, submission.answers).map(
      (item) => ({
        kind: 'canonical' as const,
        id: String(item.question.id),
        question: {
          id: Number(item.question.id),
          title: item.question.title ?? '',
          points: item.maxScore,
          order: item.question.order ?? null,
          exerciseSectionId: item.question.exerciseSectionId ?? null
        },
        definition: item.definition,
        feedback: item.feedback,
        revisionId: null
      })
    );

    return [...legacyTakeItems, ...canonicalItems].sort((leftItem, rightItem) => {
      const leftOrder = leftItem.question.order ?? 0;
      const rightOrder = rightItem.question.order ?? 0;
      return leftOrder - rightOrder;
    });
  }

  $effect(() => {
    if (prevExerciseId === exerciseId) return;
    if (prevExerciseId) {
      isSubmitting = false;
      alreadyCheckedAutoSavedData = false;
      skipHydrateFromSubmissions = false;
      hasRestoredUnfinishedDraft = false;
      selectedTryIndex = -1;
      localSubmissions = [];
      reviewedCanonicalTakeItems = [];
      canonicalValidationQuestionId = null;
    }
    prevExerciseId = exerciseId;
  });
</script>

{#if !preview && allTakeItems.length && !$questionnaireMetaData.isFinished && $questionnaireMetaData.currentQuestionIndex > 0}
  <div class="mb-6 flex min-w-0 items-center gap-3">
    <span class="ui:text-muted-foreground shrink-0 text-sm tabular-nums">
      {exerciseQuestionProgress.answered}/{exerciseQuestionProgress.total}
    </span>
    <Progress class="min-w-0 flex-1" value={$questionnaireMetaData.progressValue} />
  </div>
{/if}

<svelte:window onkeydown={handleEnterKey} />

{#if preview && !canonicalItemsLoadFailed}
  <RoleBasedSecurity allowedRoles={[1, 2]}>
    <Preview
      questions={filterOutDeleted($questionnaire.questions)}
      sections={$questionnaire.sections}
      questionnaireMetaData={$questionnaireMetaData}
      canonicalQuestions={canonicalTakeItems.map((item) => ({
        id: item.id,
        title: item.question.title,
        order: item.question.order,
        exerciseSectionId: item.question.exerciseSectionId,
        definition: item.definition
      }))}
    />
  </RoleBasedSecurity>
{/if}

{#if canonicalItemsLoadFailed}
  <Alert.Root variant="warning" class="mb-6">
    <div class="col-start-2 flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <Alert.Description>{$t('snackbar.something')}</Alert.Description>
      <Button type="button" variant="secondary" onclick={retryLoadingCanonicalItems}>
        {$t('course.navItem.lessons.exercises.all_exercises.settings_assignment_retry')}
      </Button>
    </div>
  </Alert.Root>
{:else if !preview && !allTakeItems.length && !isLoadingCanonicalItems}
  <Empty
    title={$t('course.navItem.lessons.exercises.all_exercises.view_mode.no_question')}
    icon={FileQuestionIcon}
    variant="page"
  >
    <RoleBasedSecurity allowedRoles={[1, 2]}>
      <p class="ui:text-primary text-center text-sm">
        {$t('course.navItem.lessons.exercises.all_exercises.view_mode.empty_edit_hint_prefix')}

        <span class="font-semibold">
          {$t('course.navItem.lessons.exercises.all_exercises.view_mode.edit')}
        </span>

        {$t('course.navItem.lessons.exercises.all_exercises.view_mode.empty_edit_hint_suffix')}
      </p>
    </RoleBasedSecurity>
  </Empty>
{:else if $questionnaireMetaData.currentQuestionIndex === 0}
  <RoleBasedSecurity allowedRoles={[3]}>
    <div>
      <h2 class="my-1">{$questionnaire.title}</h2>

      <div class="flex items-center">
        <p class="mx-2 dark:text-white">
          <strong>{exerciseQuestionProgress.total}</strong>
          {$t('course.navItem.lessons.exercises.all_exercises.view_mode.questions')}
        </p>
        |
        {#if hasSectionedExercise}
          <p class="mx-2 dark:text-white">
            <strong>{activeSections.length}</strong>
            {$t('course.navItem.lessons.exercises.all_exercises.view_mode.sections')}
          </p>
          |
        {/if}
        <p class="mx-2 dark:text-white">
          <strong>{getTakeItemTotalPossibleGrade(allTakeItems)}</strong>
          {$t('course.navItem.lessons.exercises.all_exercises.view_mode.points')}.
        </p>
        |
        <p class="mx-2 dark:text-white">{$t('course.navItem.lessons.exercises.all_exercises.view_mode.all')}</p>
        {#if $questionnaire.dueBy}
          |
          <p class="mx-2 dark:text-white">
            <strong>{$t('course.navItem.lessons.exercises.all_exercises.view_mode.due')}:</strong>
            {new Date($questionnaire.dueBy).toLocaleString()}
          </p>
        {/if}
      </div>

      <article class="preview prose prose-sm sm:prose mt-3 p-2">
        <SafeHtmlContent
          content={$questionnaire.description ||
            $t('course.navItem.lessons.exercises.all_exercises.view_mode.no_description')}
        />
      </article>

      <Button onclick={handleStart} type="button" class="float-right my-5">
        {$t('course.navItem.lessons.exercises.all_exercises.view_mode.start')}
      </Button>
    </div>
  </RoleBasedSecurity>
{:else if $questionnaireMetaData.isFinished}
  {#if !isLoadingAutoSavedData}
    <div class="flex w-full flex-col items-start lg:flex-row lg:items-center lg:space-x-4">
      {#if STATUS.GRADED === $questionnaireMetaData.status}
        <div class="mb-8 w-full space-y-2">
          <Badge variant="success" title={$t('course.navItem.lessons.exercises.all_exercises.view_mode.status_graded')}>
            {$t('course.navItem.lessons.exercises.all_exercises.view_mode.graded')}
          </Badge>

          <div class="flex w-full flex-col items-start gap-2 md:flex-row md:items-center">
            {#if $questionnaireMetaData.comment}
              <Alert.Callout
                variant="information"
                title={$t('course.navItem.lessons.exercises.all_exercises.view_mode.instructor_feedback')}
                description={$questionnaireMetaData.comment}
                class="h-fit! w-full! flex-1!"
              />
            {/if}
            <div class="flex flex-col justify-between gap-2 rounded-md border p-4">
              <p>
                <span class="text-2xl font-bold">{formatExercisePoints($questionnaireMetaData.finalTotalGrade)}/</span>

                <span class="text-xl">{formatExercisePoints($questionnaireMetaData.totalPossibleGrade)}</span>
              </p>
            </div>
            {#if shouldShowPassedCompletionResult}
              <Alert.Root variant={didCurrentAttemptPass ? 'information' : 'warning'} class="h-fit! w-full! flex-1!">
                <div class="col-start-2 flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div class="min-w-0 space-y-1">
                    <p class="font-medium">
                      {didCurrentAttemptPass
                        ? $t('course.navItem.lessons.exercises.all_exercises.view_mode.passed_completion_result_title')
                        : $t(
                            'course.navItem.lessons.exercises.all_exercises.view_mode.not_passed_completion_result_title'
                          )}
                    </p>
                    <p class="ui:text-muted-foreground text-sm">
                      {didCurrentAttemptPass
                        ? $t(
                            'course.navItem.lessons.exercises.all_exercises.view_mode.passed_completion_result_description',
                            {
                              scorePercent: gradedScorePercentLabel,
                              requiredPercent: passThresholdPercentLabel
                            }
                          )
                        : $t(
                            'course.navItem.lessons.exercises.all_exercises.view_mode.not_passed_completion_result_description',
                            {
                              scorePercent: gradedScorePercentLabel,
                              requiredPercent: passThresholdPercentLabel
                            }
                          )}
                    </p>
                  </div>
                  {#if $questionnaire.allowMultipleAttempts && !didCurrentAttemptPass}
                    <Button type="button" variant="outline" onclick={tryAgain} class="shrink-0">
                      {$t('course.navItem.lessons.exercises.all_exercises.view_mode.try_again')}
                    </Button>
                  {/if}
                </div>
              </Alert.Root>
            {/if}
          </div>
        </div>
      {:else if isSelfPacedLikeCourse(courseApi.course?.type)}
        <Badge
          variant="success"
          title={$t('course.navItem.lessons.exercises.all_exercises.view_mode.status_submitted')}
        >
          {$t('course.navItem.lessons.exercises.all_exercises.view_mode.submitted')}
        </Badge>
      {:else}
        <Badge variant="warning" title={$t('course.navItem.lessons.exercises.all_exercises.view_mode.status_pending')}>
          {$t('course.navItem.lessons.exercises.all_exercises.view_mode.pending')}
        </Badge>
      {/if}
    </div>

    {#if submissionList.length > 1}
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <IconButton
          disabled={viewedAttemptIndex <= 0}
          onclick={goPrevTry}
          tooltip={$t('course.navItem.lessons.exercises.all_exercises.view_mode.previous_try')}
        >
          <ChevronLeftIcon class="h-4 w-4" />
        </IconButton>
        <span class="ui:text-muted-foreground text-sm">
          {$t('course.navItem.lessons.exercises.all_exercises.view_mode.attempt_counter', {
            current: viewedAttemptIndex + 1,
            total: submissionList.length
          })}
        </span>
        <IconButton
          disabled={viewedAttemptIndex >= submissionList.length - 1}
          onclick={goNextTry}
          tooltip={$t('course.navItem.lessons.exercises.all_exercises.view_mode.next_try')}
        >
          <ChevronRightIcon class="h-4 w-4" />
        </IconButton>
      </div>
    {/if}

    <Preview
      questions={[...$questionnaire.questions].sort(
        (leftQuestion, rightQuestion) => leftQuestion.order - rightQuestion.order
      )}
      sections={$questionnaire.sections}
      questionnaireMetaData={$questionnaireMetaData}
      grades={$questionnaireMetaData.grades}
      disableGrading={true}
      canonicalQuestions={reviewedCanonicalTakeItems.map((item) => ({
        id: item.id,
        title: item.question.title,
        order: item.question.order,
        exerciseSectionId: item.question.exerciseSectionId,
        definition: item.definition,
        feedback: item.feedback
      }))}
      canonicalAnswers={$questionnaireMetaData.canonicalAnswers}
    />

    <RoleBasedSecurity allowedRoles={[3]}>
      {#if $questionnaire.allowMultipleAttempts && !shouldShowPassedCompletionResult}
        <div class="mt-4">
          <Button type="button" variant="secondary" onclick={tryAgain}>
            {$t('course.navItem.lessons.exercises.all_exercises.view_mode.try_again')}
          </Button>
        </div>
      {/if}
    </RoleBasedSecurity>
  {/if}
{:else if hasSectionedExercise && currentSection && $questionnaireMetaData.sectionPhase === 'overview'}
  <ExerciseQuestion.SectionOverview
    sectionTitle={currentSectionDisplayHtml}
    sectionDescription={currentSection.description}
    sectionNumber={$questionnaireMetaData.currentSectionIndex + 1}
    totalSections={activeSections.length}
    questionCount={currentSectionQuestionCount}
    totalPoints={sectionQuestionTotalPoints}
    colorTheme={currentSection.colorTheme}
    onBegin={beginCurrentSection}
    onBack={goBackFromSectionOverview}
    labels={{
      beginSection: $t('course.navItem.lessons.exercises.all_exercises.view_mode.begin_section'),
      back: $t('course.navItem.lessons.exercises.all_exercises.view_mode.back'),
      questions: $t('course.navItem.lessons.exercises.all_exercises.view_mode.questions'),
      points: $t('course.navItem.lessons.exercises.all_exercises.view_mode.points'),
      section: $t('course.navItem.lessons.exercises.all_exercises.section.fallback_title')
    }}
  />
{:else if hasSectionedExercise && currentSection && resolvedSectionQuestionDisplay === 'all_questions' && $questionnaireMetaData.sectionPhase === 'questions'}
  <div class="space-y-4">
    <ExerciseQuestion.SectionNavigationSidebar
      sections={sectionNavigationGroups}
      navigationLabel={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.question_outline')}
    />
    <section class="space-y-4">
      {#if $questionnaire.sectionDisplayMode === 'learner_choice'}
        <div
          class="flex justify-end"
          aria-label={$t('course.navItem.lessons.exercises.all_exercises.learner_display.label')}
        >
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-pressed={true}
            onclick={() => setLearnerSectionQuestionDisplay('one_question')}
          >
            {$t('course.navItem.lessons.exercises.all_exercises.learner_display.one_question')}
          </Button>
        </div>
      {/if}
      <ExerciseQuestion.SectionHeader
        title={currentSectionDisplayHtml}
        description={currentSection.description}
        sectionNumber={$questionnaireMetaData.currentSectionIndex + 1}
        totalSections={activeSections.length}
        colorTheme={currentSection.colorTheme}
        questionCount={currentSectionQuestionCount}
        totalPoints={sectionQuestionTotalPoints}
        labels={{
          section: $t('course.navItem.lessons.exercises.all_exercises.section.fallback_title'),
          questions: $t('course.navItem.lessons.exercises.all_exercises.view_mode.questions'),
          points: $t('course.navItem.lessons.exercises.all_exercises.view_mode.points')
        }}
      />

      {#each currentSectionTakeItems as sectionTakeItem, sectionQuestionIndex (sectionTakeItem.id)}
        {#if sectionTakeItem.kind === 'canonical'}
          <div id={getCanonicalQuestionElementId(sectionTakeItem.id)}>
            <ExerciseQuestion.AssessmentItemRenderer
              definition={sectionTakeItem.definition}
              response={$questionnaireMetaData.canonicalAnswers[sectionTakeItem.id]}
              disabled={isSubmitting}
              title={sectionTakeItem.question.title}
              trueLabel={$t('course.navItem.lessons.exercises.all_exercises.shared_question.true_false.true_label')}
              falseLabel={$t('course.navItem.lessons.exercises.all_exercises.shared_question.true_false.false_label')}
              questionNumber={interactionNumberStartByItemId[sectionTakeItem.id] ?? sectionQuestionIndex + 1}
              interactionNumberStart={interactionNumberStartByItemId[sectionTakeItem.id] ?? sectionQuestionIndex + 1}
              questionNumberActive={false}
              showItemHeader={sectionTakeItem.definition.presentation?.layout !== 'passage_split'}
              showContainer
              validationRequested={canonicalValidationQuestionId === sectionTakeItem.id}
              validationMessage={$t('course.navItem.lessons.exercises.all_exercises.view_mode.answer_required')}
              focusRequestKey={canonicalFocusRequestKey}
              {passageWorkspaceLabels}
              onResponseChange={(response) => onCanonicalResponseChange(sectionTakeItem.id, response)}
            />
          </div>
        {:else}
          {@const sectionQuestionModel = toExerciseQuestionModel(sectionTakeItem.question)}
          {@const sectionQuestionKey = getExerciseQuestionContractKey(sectionQuestionModel)}
          <ExerciseQuestion.QuestionRenderer
            contract={{
              mode: 'take',
              question: sectionQuestionModel,
              answer: $questionnaireMetaData.answers[sectionQuestionKey],
              labels: questionLabels,
              disabled: isSubmitting,
              platformMaxFileSizeMb,
              onFileUpload: handleFileUpload,
              onVideoRecordingUpload: handleVideoRecordingUpload
            }}
            questionNumber={interactionNumberStartByItemId[sectionTakeItem.id] ?? sectionQuestionIndex + 1}
            questionNumberActive={false}
            onAnswerChange={(answerValue) => onSectionQuestionAnswerChange(sectionTakeItem.question, answerValue)}
          />
        {/if}
      {/each}

      <div class="flex justify-end">
        <Button type="button" onclick={completeAllQuestionsSection} disabled={isSubmitting} loading={isSubmitting}>
          {$questionnaireMetaData.currentSectionIndex === activeSections.length - 1
            ? $t('course.navItem.lessons.exercises.all_exercises.finish')
            : $t('course.navItem.lessons.exercises.all_exercises.view_mode.complete_section')}
        </Button>
      </div>
    </section>
  </div>
{:else if currentTakeItem}
  <div class={hasSectionedExercise ? 'space-y-4' : ''}>
    {#if hasSectionedExercise}
      <ExerciseQuestion.SectionNavigationSidebar
        sections={sectionNavigationGroups}
        navigationLabel={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.question_outline')}
      />
    {/if}
    <div class="flex min-w-0 flex-col gap-4">
      {#if hasSectionedExercise && currentSection}
        {#if $questionnaire.sectionDisplayMode === 'learner_choice'}
          <div
            class="flex justify-end"
            aria-label={$t('course.navItem.lessons.exercises.all_exercises.learner_display.label')}
          >
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-pressed={true}
              onclick={() => setLearnerSectionQuestionDisplay('all_questions')}
            >
              {$t('course.navItem.lessons.exercises.all_exercises.learner_display.all_questions')}
            </Button>
          </div>
        {/if}
        <ExerciseQuestion.SectionHeader
          title={currentSectionDisplayHtml}
          description={currentSection.description}
          sectionNumber={$questionnaireMetaData.currentSectionIndex + 1}
          totalSections={activeSections.length}
          colorTheme={currentSection.colorTheme}
          questionCount={currentSectionQuestionCount}
          totalPoints={sectionQuestionTotalPoints}
          labels={{
            section: $t('course.navItem.lessons.exercises.all_exercises.section.fallback_title'),
            questions: $t('course.navItem.lessons.exercises.all_exercises.view_mode.questions'),
            points: $t('course.navItem.lessons.exercises.all_exercises.view_mode.points')
          }}
        />
      {/if}
      <div class="grid overflow-hidden" style="grid-template-areas: 'slot';">
        {#key currentTakeItem.id}
          <div
            id="question"
            class="min-w-0 [grid-area:slot]"
            in:fly={{ x: flyX, duration: 350, easing: cubicInOut }}
            out:fly={{ x: flyOutX, duration: 350, easing: cubicInOut }}
          >
            {#if currentTakeItem.kind === 'canonical'}
              <div id={getCanonicalQuestionElementId(currentTakeItem.id)}>
                <ExerciseQuestion.AssessmentItemRenderer
                  definition={currentTakeItem.definition}
                  response={$questionnaireMetaData.canonicalAnswers[currentTakeItem.id]}
                  disabled={isSubmitting}
                  title={currentTakeItem.question.title}
                  trueLabel={$t('course.navItem.lessons.exercises.all_exercises.shared_question.true_false.true_label')}
                  falseLabel={$t(
                    'course.navItem.lessons.exercises.all_exercises.shared_question.true_false.false_label'
                  )}
                  questionNumber={interactionNumberStartByItemId[currentTakeItem.id] ??
                    $questionnaireMetaData.currentQuestionIndex}
                  interactionNumberStart={interactionNumberStartByItemId[currentTakeItem.id] ??
                    $questionnaireMetaData.currentQuestionIndex}
                  showItemHeader={currentTakeItem.definition.presentation?.layout !== 'passage_split'}
                  showContainer
                  validationRequested={canonicalValidationQuestionId === currentTakeItem.id}
                  validationMessage={$t('course.navItem.lessons.exercises.all_exercises.view_mode.answer_required')}
                  focusRequestKey={canonicalFocusRequestKey}
                  {passageWorkspaceLabels}
                  onResponseChange={(response) => onCanonicalResponseChange(currentTakeItem.id, response)}
                />
              </div>
            {:else if sharedQuestionModel}
              <ExerciseQuestion.QuestionRenderer
                contract={{
                  mode: 'take',
                  question: sharedQuestionModel,
                  answer: sharedCurrentAnswer,
                  labels: questionLabels,
                  disabled: isSubmitting,
                  platformMaxFileSizeMb,
                  onFileUpload: handleFileUpload,
                  onVideoRecordingUpload: handleVideoRecordingUpload
                }}
                questionNumber={interactionNumberStartByItemId[currentTakeItem.id] ??
                  $questionnaireMetaData.currentQuestionIndex}
                onAnswerChange={onSharedAnswerChange}
              />
            {/if}
          </div>
        {/key}
      </div>
      <div>
        <ExerciseQuestion.QuestionNavigation
          canGoBack={hasSectionedExercise || $questionnaireMetaData.currentQuestionIndex > 1}
          canGoNext={currentTakeItem.kind === 'canonical'
            ? !isSubmitting
            : canGoNextForCurrentTakeItem && !isSubmitting}
          isLast={$questionnaireMetaData.currentQuestionIndex === currentTakeItemList.length}
          {isSubmitting}
          previousLabel={t.get('course.navItem.lessons.exercises.all_exercises.previous')}
          nextLabel={t.get('course.navItem.lessons.exercises.all_exercises.next')}
          finishLabel={t.get('course.navItem.lessons.exercises.all_exercises.finish')}
          {onPrevious}
          onNext={() => {
            if (currentTakeItem.kind === 'canonical') {
              onCanonicalNext(currentTakeItem);
              return;
            }

            onSharedNext();
          }}
        />
      </div>
    </div>
  </div>
{/if}
