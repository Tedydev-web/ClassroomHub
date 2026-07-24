import { DEFAULT_QUESTION_TYPE, QUESTION_TEMPLATE } from '$features/ui/question/constants';
import type {
  AnswerData,
  AssessmentDeliveryDefinition,
  AssessmentGradingMode,
  AssessmentResponseEnvelope,
  ExerciseSectionAfterBehavior,
  ExerciseSectionColorTheme,
  ExerciseSectionDisplayMode
} from '@cio/question-types';

import type { Question } from '$features/course/types';
import type { Exercise } from '$features/course/utils/types';
import type { UpdateExerciseData } from '$features/course/utils/types';
import type { TAssessmentItemMutation } from '@cio/utils/validation/exercise';
import { STATUS } from './constants';
import type { Writable } from 'svelte/store';
import { isUUID } from '$lib/utils/functions/isUUID';
import { get, writable } from 'svelte/store';
import { UNTITLED_EXERCISE_SECTION_TITLE } from '$features/course/utils/exercise-section-utils';

export const isQuestionnaireFetching = writable(false);
export const deleteConfirmation = writable({ open: false });
export const questionnaireOrder = writable({ open: false });

export interface ExerciseEditorFieldErrors {
  option?: string;
  title?: string;
  points?: string;
  description?: string;
}

export type ExerciseEditorErrors = Record<string, ExerciseEditorFieldErrors>;

// {'question-or-section-id': { option: '', title: '', description: '', ... }}
export const questionnaireValidation = writable<ExerciseEditorErrors>({});

type AssessmentComposerSaveHandler = () => Promise<boolean>;
type AssessmentItemMutationResult = NonNullable<UpdateExerciseData['assessmentItemMutationResults']>[number];

type AssessmentComposerMutationHandler = {
  prepare: () => TAssessmentItemMutation | null;
  reconcile: (question: CanonicalQuestionState) => Promise<void> | void;
};

const assessmentComposerSaveHandlers = new Map<string, AssessmentComposerSaveHandler>();
const assessmentComposerMutationHandlers = new Map<string, AssessmentComposerMutationHandler>();
export const dirtyAssessmentComposerIds = writable<ReadonlySet<string>>(new Set());
export const wideAssessmentComposerIds = writable<ReadonlySet<string>>(new Set());

export interface AssessmentComposerPreviewItem {
  exerciseId: string;
  questionId: number | null;
  title: string;
  points: number;
  order: number;
  exerciseSectionId: string | null;
  gradingMode: AssessmentGradingMode;
  definition: AssessmentDeliveryDefinition;
}

export const assessmentComposerPreviewItems = writable<Readonly<Record<string, AssessmentComposerPreviewItem>>>({});

export function setAssessmentComposerPreviewItem(composerId: string, item: AssessmentComposerPreviewItem): void {
  assessmentComposerPreviewItems.update((currentItems) => ({
    ...currentItems,
    [composerId]: item
  }));
}

export function removeAssessmentComposerPreviewItem(composerId: string): void {
  assessmentComposerPreviewItems.update((currentItems) => {
    if (!(composerId in currentItems)) return currentItems;

    const nextItems = { ...currentItems };
    delete nextItems[composerId];

    return nextItems;
  });
}

export function registerAssessmentComposerSaveHandler(
  composerId: string,
  saveHandler: AssessmentComposerSaveHandler
): () => void {
  assessmentComposerSaveHandlers.set(composerId, saveHandler);

  return () => {
    assessmentComposerSaveHandlers.delete(composerId);
    setAssessmentComposerDirty(composerId, false);
  };
}

export function registerAssessmentComposerMutationHandler(
  composerId: string,
  handler: AssessmentComposerMutationHandler
): () => void {
  assessmentComposerMutationHandlers.set(composerId, handler);

  return () => {
    assessmentComposerMutationHandlers.delete(composerId);
  };
}

export function prepareDirtyAssessmentItemMutations(): {
  success: boolean;
  mutations: TAssessmentItemMutation[];
} {
  const mutations: TAssessmentItemMutation[] = [];
  for (const composerId of get(dirtyAssessmentComposerIds)) {
    const handler = assessmentComposerMutationHandlers.get(composerId);
    if (!handler) {
      console.error(`Missing mutation handler for dirty assessment composer "${composerId}"`);
      return { success: false, mutations: [] };
    }

    const mutation = handler.prepare();
    if (!mutation) return { success: false, mutations: [] };
    mutations.push(mutation);
  }

  return { success: true, mutations };
}

export async function reconcileAssessmentItemMutations(
  results: AssessmentItemMutationResult[],
  canonicalQuestions: CanonicalQuestionState[]
): Promise<boolean> {
  const canonicalQuestionById = new Map(canonicalQuestions.map((question) => [Number(question.id), question]));
  for (const result of results) {
    const handler = assessmentComposerMutationHandlers.get(result.clientMutationId);
    const question = canonicalQuestionById.get(result.questionId);
    if (!handler || !question) {
      console.error(
        `Missing assessment composer reconciliation state for mutation "${result.clientMutationId}" and question "${result.questionId}"`
      );
      return false;
    }

    await handler.reconcile(question);
  }

  return true;
}

export function setAssessmentComposerDirty(composerId: string, isDirty: boolean): void {
  dirtyAssessmentComposerIds.update((currentIds) => {
    const nextIds = new Set(currentIds);
    if (isDirty) nextIds.add(composerId);
    else nextIds.delete(composerId);

    return nextIds;
  });
}

export function setAssessmentComposerWide(composerId: string, isWide: boolean): void {
  wideAssessmentComposerIds.update((currentIds) => {
    const nextIds = new Set(currentIds);
    if (isWide) nextIds.add(composerId);
    else nextIds.delete(composerId);

    return nextIds;
  });
}

export async function saveDirtyAssessmentComposers(): Promise<boolean> {
  const dirtyComposerIds = [...get(dirtyAssessmentComposerIds)];
  for (const composerId of dirtyComposerIds) {
    const saveHandler = assessmentComposerSaveHandlers.get(composerId);
    if (!saveHandler) {
      console.error(`Missing save handler for dirty assessment composer "${composerId}"`);
      return false;
    }

    if (!(await saveHandler())) return false;
  }

  return true;
}

export function clearAssessmentComposerRegistry(): void {
  assessmentComposerSaveHandlers.clear();
  assessmentComposerMutationHandlers.clear();
  dirtyAssessmentComposerIds.set(new Set());
  wideAssessmentComposerIds.set(new Set());
  assessmentComposerPreviewItems.set({});
}

export interface QuestionnaireMetaData {
  answers: Record<string, AnswerData | undefined>;
  canonicalAnswers: Record<string, AssessmentResponseEnvelope | undefined>;
  canonicalRevisionIds: Record<string, string>;
  scores: Record<string, number>;
  grades: Record<string, number>;
  totalPossibleGrade: number;
  finalTotalGrade: number;
  currentQuestionIndex: number;
  isFinished: boolean;
  progressValue: number;
  status: number;
  comment: string;
  /** Set when exercise is finished so route knows not to overwrite questionnaire */
  exerciseId: string | null;
  currentSectionIndex: number;
  sectionPhase: 'overview' | 'questions';
}

export interface ExerciseSectionState {
  id: string;
  title: string;
  description: string | null;
  order: number;
  colorTheme: ExerciseSectionColorTheme;
  afterBehavior: ExerciseSectionAfterBehavior;
  isDirty?: boolean;
  deletedAt?: string;
}

export type CanonicalQuestionState = NonNullable<Exercise['canonicalQuestions']>[number] & {
  isPlacementDirty?: boolean;
};

export type ExerciseQuestionPlacementItem =
  | { id: string; kind: 'legacy'; question: Question }
  | { id: string; kind: 'canonical'; question: CanonicalQuestionState };

export interface QuestionnaireState {
  title?: string | null;
  dueBy?: string | null;
  isDueByDirty?: boolean;
  isTitleDirty?: boolean;
  description?: string | null;
  isDescriptionDirty?: boolean;
  questions: Question[];
  canonicalQuestions: CanonicalQuestionState[];
  sections: ExerciseSectionState[];
  sectionDisplayMode: ExerciseSectionDisplayMode;
  totalSubmissions: number;
  allowMultipleAttempts?: boolean;
  completionPolicy?: 'submitted' | 'passed';
  passThreshold?: number | null;
  slug?: string | null;
}

const initAnswerState: QuestionnaireMetaData = {
  answers: {},
  canonicalAnswers: {},
  canonicalRevisionIds: {},
  scores: {},
  grades: {},
  totalPossibleGrade: 0,
  finalTotalGrade: 0,
  currentQuestionIndex: 0,
  isFinished: false,
  progressValue: 0,
  status: STATUS.PENDING,
  comment: '',
  exerciseId: null,
  currentSectionIndex: 0,
  sectionPhase: 'overview'
};

export const questionnaireMetaData: Writable<QuestionnaireMetaData> = writable(initAnswerState);

export const questionnaire: Writable<QuestionnaireState> = writable({
  title: '',
  dueBy: '',
  isDueByDirty: false,
  isTitleDirty: false,
  description: '',
  isDescriptionDirty: false,
  questions: [],
  canonicalQuestions: [],
  sections: [],
  sectionDisplayMode: 'one_question',
  totalSubmissions: 0,
  allowMultipleAttempts: false,
  completionPolicy: 'submitted',
  passThreshold: 100,
  slug: ''
});

export function clearQuestionnaireValidation() {
  questionnaireValidation.set({});
}

export function reset() {
  questionnaireMetaData.update((metaData) => ({
    ...metaData,
    answers: {},
    canonicalAnswers: {},
    canonicalRevisionIds: {},
    scores: {},
    grades: {},
    currentQuestionIndex: 0,
    isFinished: false,
    exerciseId: null,
    totalPossibleGrade: 0,
    finalTotalGrade: 0,
    status: STATUS.PENDING,
    comment: '',
    progressValue: 100,
    currentSectionIndex: 0,
    sectionPhase: 'overview'
  }));

  clearQuestionnaireValidation();
}

/** Clears take-exercise state so the student can start another attempt (when allowed). */
export function resetStudentExerciseTake() {
  questionnaireMetaData.set({
    ...initAnswerState,
    exerciseId: null
  });
  clearQuestionnaireValidation();
}

/**
 * Maps Zod validation errors to UI format: { questionId: { option: 'error message' } }
 * This is used to display errors in the edit-mode component
 */
export function mapZodErrorsToQuestionErrors(
  zodErrors: Record<string, string>,
  questions: Question[]
): ExerciseEditorErrors {
  const errors: ExerciseEditorErrors = {};
  for (const [path, message] of Object.entries(zodErrors)) {
    const pathParts = path.split('.');
    const questionIndex = pathParts[0] === 'questions' ? parseInt(pathParts[1]) : -1;

    if (questionIndex >= 0 && questionIndex < questions.length) {
      const question = questions[questionIndex];
      if (question && !question.deletedAt) {
        const qErrors = errors[question.id] || {};

        // Check if error is related to options
        if (path.includes('options')) {
          qErrors.option = message;
        } else if (path.includes('question')) {
          qErrors.title = message;
        } else if (path.includes('points')) {
          qErrors.points = message;
        }

        errors[question.id] = { ...qErrors };
      }
    }
  }

  return errors;
}

export function hasSections(sections: ExerciseSectionState[]) {
  return sections.some((section) => !section.deletedAt);
}

function compareQuestionsByOrder(leftQuestion: Question, rightQuestion: Question) {
  const leftOrder = leftQuestion.order ?? 0;
  const rightOrder = rightQuestion.order ?? 0;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;

  return String(leftQuestion.id).localeCompare(String(rightQuestion.id), undefined, { numeric: true });
}

export function getQuestionsForSection(questions: Question[], exerciseSectionId: string) {
  return questions
    .filter((question) => !question.deletedAt && question.exerciseSectionId === exerciseSectionId)
    .sort(compareQuestionsByOrder);
}

export function getQuestionPlacementItemsForSection(
  questions: Question[],
  canonicalQuestions: CanonicalQuestionState[],
  exerciseSectionId: string | null
): ExerciseQuestionPlacementItem[] {
  const legacyItems: ExerciseQuestionPlacementItem[] = questions
    .filter((question) => !question.deletedAt && (question.exerciseSectionId ?? null) === exerciseSectionId)
    .map((question) => ({ id: `legacy:${question.id}`, kind: 'legacy', question }));
  const canonicalItems: ExerciseQuestionPlacementItem[] = canonicalQuestions
    .filter((question) => (question.exerciseSectionId ?? null) === exerciseSectionId)
    .map((question) => ({ id: `canonical:${question.id}`, kind: 'canonical', question }));

  return [...legacyItems, ...canonicalItems].sort((leftItem, rightItem) => {
    const orderDifference = (leftItem.question.order ?? 0) - (rightItem.question.order ?? 0);
    if (orderDifference !== 0) return orderDifference;

    return leftItem.id.localeCompare(rightItem.id);
  });
}

export function handleReorderQuestionPlacementItems(
  exerciseSectionId: string | null,
  orderedItems: ExerciseQuestionPlacementItem[]
) {
  const nextLegacyPlacementById = new Map<string, number>();
  const nextCanonicalPlacementById = new Map<string, number>();

  for (const [order, item] of orderedItems.entries()) {
    const targetMap = item.kind === 'legacy' ? nextLegacyPlacementById : nextCanonicalPlacementById;
    targetMap.set(String(item.question.id), order);
  }

  questionnaire.update((state) => ({
    ...state,
    questions: state.questions.map((question) => {
      const nextOrder = nextLegacyPlacementById.get(String(question.id));
      if (nextOrder === undefined) return question;
      if (question.order === nextOrder && (question.exerciseSectionId ?? null) === exerciseSectionId) return question;

      return { ...question, exerciseSectionId, order: nextOrder, isDirty: true };
    }),
    canonicalQuestions: state.canonicalQuestions.map((question) => {
      const nextOrder = nextCanonicalPlacementById.get(String(question.id));
      if (nextOrder === undefined) return question;
      if (question.order === nextOrder && (question.exerciseSectionId ?? null) === exerciseSectionId) return question;

      return { ...question, exerciseSectionId, order: nextOrder, isPlacementDirty: true };
    })
  }));
}

export function handleAddQuestion(exerciseSectionId?: string | null) {
  let nextQuestionId: string | number = '';

  questionnaire.update((q) => {
    const { questions } = q;
    const activeSections = q.sections.filter((section) => !section.deletedAt);
    const nextExerciseSectionId = exerciseSectionId ?? (activeSections.length > 0 ? activeSections[0].id : null);
    const placementItems = getQuestionPlacementItemsForSection(questions, q.canonicalQuestions, nextExerciseSectionId);
    const nextQuestionOrder =
      placementItems.reduce((highestOrder, item) => Math.max(highestOrder, item.question.order ?? 0), -1) + 1;
    nextQuestionId = `${questions.length + 1}-form`;

    return {
      ...q,
      questions: [
        ...questions,
        {
          ...QUESTION_TEMPLATE,
          id: nextQuestionId,
          name: `${nextQuestionId}`,
          value: '',
          points: 0,
          order: nextQuestionOrder,
          exerciseSectionId: nextExerciseSectionId,
          questionType: DEFAULT_QUESTION_TYPE,
          questionTypeId: DEFAULT_QUESTION_TYPE.id,
          options: [
            {
              id: '1-form',
              label: '',
              value: null,
              isCorrect: false
            }
          ]
        }
      ]
    };
  });

  return nextQuestionId;
}

function isUntouchedLegacyQuestionDraft(question: Question): boolean {
  if (typeof question.id !== 'string' || !question.id.endsWith('-form') || question.isDirty) return false;

  const hasTitle = question.title.trim() !== '';
  const hasPoints = Number(question.points ?? 0) !== 0;
  const hasAnswer = question.answers.some((answer) => answer !== null && `${answer}`.trim() !== '');
  const hasOptionContent = question.options.some((option) => {
    const label = option.label ?? '';
    const value = option.value ?? '';

    return `${label}`.trim() !== '' || `${value}`.trim() !== '' || option.isCorrect;
  });
  const hasSettings = Object.keys(question.settings ?? {}).length > 0;

  return !hasTitle && !hasPoints && !hasAnswer && !hasOptionContent && !hasSettings;
}

export function removeUntouchedLegacyQuestionDrafts(): void {
  questionnaire.update((state) => {
    const questions = state.questions.filter((question) => !isUntouchedLegacyQuestionDraft(question));
    if (questions.length === state.questions.length) return state;

    return { ...state, questions };
  });
}

export function handleAddSection() {
  let nextSectionId = '';

  questionnaire.update((q) => {
    const activeSections = q.sections.filter((section) => !section.deletedAt);
    const firstAvailableSectionOrder =
      activeSections.reduce((highestOrder, section) => Math.max(highestOrder, section.order), -1) + 1;
    const activeUnsectionedQuestions = q.questions.filter(
      (question) => !question.deletedAt && !question.exerciseSectionId
    );
    const activeUnsectionedCanonicalQuestions = q.canonicalQuestions.filter((question) => !question.exerciseSectionId);
    const hasUnsectionedQuestions =
      activeUnsectionedQuestions.length > 0 || activeUnsectionedCanonicalQuestions.length > 0;
    const nextSectionDisplayNumber = activeSections.length + (hasUnsectionedQuestions ? 2 : 1);
    const nextSections = [...q.sections];
    let questions = q.questions;
    let canonicalQuestions = q.canonicalQuestions;
    let nextSectionOrder = firstAvailableSectionOrder;

    if (hasUnsectionedQuestions) {
      const untitledSectionId = crypto.randomUUID();
      const untitledSection: ExerciseSectionState = {
        id: untitledSectionId,
        title: UNTITLED_EXERCISE_SECTION_TITLE,
        description: null,
        order: nextSectionOrder,
        colorTheme: 'blue',
        afterBehavior: { action: 'continue' },
        isDirty: true
      };

      nextSectionOrder += 1;
      nextSections.push(untitledSection);
      questions = q.questions.map((question) => {
        if (question.deletedAt || question.exerciseSectionId) return question;

        return {
          ...question,
          exerciseSectionId: untitledSectionId,
          isDirty: true
        };
      });
      canonicalQuestions = q.canonicalQuestions.map((question) => {
        if (question.exerciseSectionId) return question;

        return {
          ...question,
          exerciseSectionId: untitledSectionId,
          isPlacementDirty: true
        };
      });
    }

    const sectionId = crypto.randomUUID();
    nextSectionId = sectionId;
    const nextSection: ExerciseSectionState = {
      id: sectionId,
      title: `Section ${nextSectionDisplayNumber}`,
      description: null,
      order: nextSectionOrder,
      colorTheme: 'blue',
      afterBehavior: { action: 'continue' },
      isDirty: true
    };

    return {
      ...q,
      questions,
      canonicalQuestions,
      sections: [...nextSections, nextSection]
    };
  });

  return nextSectionId;
}

export function handleRemoveSection(exerciseSectionId: string, moveQuestionsToExerciseSectionId?: string | null) {
  questionnaire.update((q) => {
    const activeSections = q.sections.filter((section) => !section.deletedAt);
    const remainingSections = activeSections.filter((section) => section.id !== exerciseSectionId);
    const shouldClearSections = remainingSections.length === 0;
    const deletedAt = new Date().toString();
    const targetExerciseSectionId = shouldClearSections ? null : (moveQuestionsToExerciseSectionId ?? null);
    const sourceQuestions = [
      ...q.questions
        .filter((question) => !question.deletedAt && question.exerciseSectionId === exerciseSectionId)
        .map((question) => ({ id: String(question.id), order: question.order ?? 0 })),
      ...q.canonicalQuestions
        .filter((question) => question.exerciseSectionId === exerciseSectionId)
        .map((question) => ({ id: String(question.id), order: question.order ?? 0 }))
    ].sort((leftQuestion, rightQuestion) => leftQuestion.order - rightQuestion.order);
    const highestTargetOrder = [
      ...q.questions
        .filter(
          (question) =>
            !question.deletedAt &&
            question.exerciseSectionId === targetExerciseSectionId &&
            question.exerciseSectionId !== exerciseSectionId
        )
        .map((question) => question.order ?? 0),
      ...q.canonicalQuestions
        .filter(
          (question) =>
            question.exerciseSectionId === targetExerciseSectionId && question.exerciseSectionId !== exerciseSectionId
        )
        .map((question) => question.order ?? 0)
    ].reduce((highestOrder, order) => Math.max(highestOrder, order), -1);
    const nextOrderByQuestionId = new Map(
      sourceQuestions.map((question, index) => [question.id, highestTargetOrder + index + 1])
    );

    return {
      ...q,
      sections: q.sections.map((section) => {
        if (section.id === exerciseSectionId) return { ...section, deletedAt, isDirty: true };
        if (
          section.afterBehavior.action === 'go_to_section' &&
          section.afterBehavior.exerciseSectionId === exerciseSectionId
        ) {
          return { ...section, afterBehavior: { action: 'continue' }, isDirty: true };
        }

        return section;
      }),
      questions: q.questions.map((question) => {
        if (question.exerciseSectionId !== exerciseSectionId) return question;

        if (moveQuestionsToExerciseSectionId || shouldClearSections) {
          return {
            ...question,
            exerciseSectionId: targetExerciseSectionId,
            order: nextOrderByQuestionId.get(String(question.id)) ?? question.order,
            isDirty: true
          };
        }

        return {
          ...question,
          deletedAt,
          isDirty: true
        };
      }),
      canonicalQuestions: q.canonicalQuestions.map((question) => {
        if (question.exerciseSectionId !== exerciseSectionId) return question;
        if (!moveQuestionsToExerciseSectionId && !shouldClearSections) return question;

        return {
          ...question,
          exerciseSectionId: targetExerciseSectionId,
          order: nextOrderByQuestionId.get(String(question.id)) ?? question.order,
          isPlacementDirty: true
        };
      })
    };
  });
}

export function handleMoveQuestionToSection(questionId: string | number, exerciseSectionId: string | null) {
  questionnaire.update((q) => ({
    ...q,
    questions: q.questions.map((question) =>
      question.id === questionId ? { ...question, exerciseSectionId, isDirty: true } : question
    )
  }));
}

export function handleUpdateSectionAfterBehavior(
  exerciseSectionId: string,
  afterBehavior: ExerciseSectionAfterBehavior
) {
  questionnaire.update((q) => ({
    ...q,
    sections: q.sections.map((section) =>
      section.id === exerciseSectionId ? { ...section, afterBehavior, isDirty: true } : section
    )
  }));
}

export function handleUpdateSectionColorTheme(exerciseSectionId: string, colorTheme: ExerciseSectionColorTheme) {
  questionnaire.update((q) => ({
    ...q,
    sections: q.sections.map((section) =>
      section.id === exerciseSectionId ? { ...section, colorTheme, isDirty: true } : section
    )
  }));
}

export function handleUpdateSectionTitle(exerciseSectionId: string, title: string) {
  questionnaire.update((q) => ({
    ...q,
    sections: q.sections.map((section) =>
      section.id === exerciseSectionId ? { ...section, title, isDirty: true } : section
    )
  }));
}

export function handleUpdateSectionDescription(exerciseSectionId: string, description: string | null) {
  questionnaire.update((q) => ({
    ...q,
    sections: q.sections.map((section) =>
      section.id === exerciseSectionId ? { ...section, description, isDirty: true } : section
    )
  }));
}

export function handleReorderSections(orderedSectionIds: string[]) {
  const orderBySectionId = new Map(orderedSectionIds.map((sectionId, index) => [sectionId, index]));

  questionnaire.update((q) => ({
    ...q,
    sections: q.sections.map((section) => {
      const nextOrder = orderBySectionId.get(section.id);
      if (nextOrder === undefined || nextOrder === section.order) return section;

      return { ...section, order: nextOrder, isDirty: true };
    })
  }));
}

export function handleReorderQuestionsInSection(exerciseSectionId: string, orderedQuestionIds: Array<string | number>) {
  questionnaire.update((q) => {
    const activeSections = [...q.sections].filter((section) => !section.deletedAt).sort((a, b) => a.order - b.order);
    const sectionExists = activeSections.some((section) => section.id === exerciseSectionId);
    if (!sectionExists) return q;

    const questionById = new Map(q.questions.map((question) => [String(question.id), question]));
    const orderedQuestionIdSet = new Set(orderedQuestionIds.map((questionId) => String(questionId)));
    const reorderedActiveQuestions: Question[] = [];

    for (const section of activeSections) {
      const sectionQuestions = getQuestionsForSection(q.questions, section.id);

      if (section.id !== exerciseSectionId) {
        reorderedActiveQuestions.push(...sectionQuestions);
        continue;
      }

      const orderedSectionQuestions = orderedQuestionIds
        .map((questionId) => questionById.get(String(questionId)))
        .filter(
          (question): question is Question =>
            Boolean(question) && !question.deletedAt && question.exerciseSectionId === exerciseSectionId
        );
      const missingSectionQuestions = sectionQuestions.filter(
        (question) => !orderedQuestionIdSet.has(String(question.id))
      );
      reorderedActiveQuestions.push(...orderedSectionQuestions, ...missingSectionQuestions);
    }

    const activeUnsectionedQuestions = q.questions
      .filter((question) => !question.deletedAt && !question.exerciseSectionId)
      .sort(compareQuestionsByOrder);
    const nextOrderByQuestionId = new Map(
      [...reorderedActiveQuestions, ...activeUnsectionedQuestions].map((question, index) => [
        String(question.id),
        index + 1
      ])
    );

    return {
      ...q,
      questions: q.questions.map((question) => {
        const nextOrder = nextOrderByQuestionId.get(String(question.id));
        if (nextOrder === undefined || question.order === nextOrder) return question;

        return { ...question, order: nextOrder, isDirty: true };
      })
    };
  });
}

export function handleAddOption(questionId) {
  return () => {
    questionnaire.update((_questionnaire) => {
      const { questions } = _questionnaire;
      return {
        ..._questionnaire,
        questions: questions.map((question) => {
          if (question.id === questionId) {
            return {
              ...question,
              options: [
                ...question.options,
                {
                  id: `${new Date().getTime()}-form`,
                  label: '',
                  value: '',
                  isCorrect: false
                }
              ]
            };
          }

          return question;
        })
      };
    });
  };
}

export function handleRemoveOption(questionId, optionId) {
  return () => {
    questionnaire.update((q) => {
      const questionIndex = q.questions.findIndex((qItem) => qItem.id === questionId);
      if (questionIndex === -1) return q;

      const optionsIndex = q.questions[questionIndex].options.findIndex((oItem) => oItem.id === optionId);
      if (optionsIndex === -1) return q;

      q.questions[questionIndex].options[optionsIndex].deletedAt = new Date().toString();
      q.questions[questionIndex].options[optionsIndex].isDirty = true;
      q.questions[questionIndex].isDirty = true; // Mark as dirty if needed

      return q;
    });
  };
}

export function handleRemoveQuestion(questionId) {
  return () => {
    questionnaire.update((q) => {
      const questionIndex = q.questions.findIndex((qItem) => qItem.id === questionId);
      if (questionIndex === -1) return q;

      q.questions[questionIndex].deletedAt = new Date().toString();

      return q;
    });
  };
}

export function handleCode(questionId, shouldAdd = true) {
  questionnaire.update((q) => {
    const questionIndex = q.questions.findIndex((qItem) => qItem.id === questionId);
    if (questionIndex === -1) return q;

    const question = q.questions[questionIndex];
    q.questions[questionIndex].code = shouldAdd ? question.code || '' : undefined;

    return q;
  });
}

export function handleAnswerSelect(questionId, optionId) {
  return () => {
    questionnaire.update((q) => {
      const { questions } = q;

      return {
        ...q,
        questions: questions.map((question) => {
          if (question.id === questionId) {
            return {
              ...question,
              options: question.options.map((option) => {
                if (option.id === optionId) {
                  option.isCorrect = !option.isCorrect;
                  option.isDirty = true;
                }
                return option;
              })
            };
          }

          return question;
        })
      };
    });
  };
}

export function addDynamicValue(questionId, optionId) {
  return (e) => {
    questionnaire.update((q) => {
      const { questions } = q;

      return {
        ...q,
        questions: questions.map((question) => {
          if (question.id === questionId) {
            return {
              ...question,
              options: question.options.map((option) => {
                if (option.id === optionId) {
                  const label = e.target.value;

                  if (!isUUID(option.value || '')) {
                    option.value = label.split(' ').join('-');
                  }

                  option.label = label;
                  option.isDirty = true;
                }

                return option;
              })
            };
          }

          return question;
        })
      };
    });
  };
}
