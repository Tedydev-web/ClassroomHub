import {
  deriveItemCapabilities,
  getItemMaxScore,
  isAutoGradableQuestionTypeId,
  type AssessmentGradingMode
} from '@cio/question-types';
import type { TAssessmentItemMutation } from '@cio/utils/validation/exercise';

import type { Question } from '$features/course/types';
import type { SubmissionListItem } from '$features/course/utils/types';

export type ExerciseCompletionPolicy = 'submitted' | 'passed';

export type ExerciseAttempt = {
  attemptNumber: number;
  submission: SubmissionListItem;
};

export type ExerciseSubmissionStudentGroup = {
  studentKey: string;
  studentName: string;
  studentAvatarUrl: string;
  attempts: ExerciseAttempt[];
};

export type CanonicalExerciseQuestionSummary = {
  id: string | number;
  title: string;
  points: number | null;
  gradingMode: AssessmentGradingMode;
};

type ExerciseOrderedItem = {
  id: string;
  question: {
    order?: number | null;
    exerciseSectionId?: string | null;
  };
};

type ExerciseOrderedSection = {
  id: string;
  order: number;
};

export function getActiveExerciseQuestions(questions: Question[]): Question[] {
  return questions.filter((question) => !question.deletedAt);
}

export function orderExerciseItemsBySections<T extends ExerciseOrderedItem>(
  items: ReadonlyArray<T>,
  sections: ReadonlyArray<ExerciseOrderedSection>
): T[] {
  const orderedSections = [...sections].sort(
    (leftSection, rightSection) =>
      leftSection.order - rightSection.order || leftSection.id.localeCompare(rightSection.id)
  );
  const sectionIndexById = new Map(orderedSections.map((section, index) => [section.id, index]));
  const unsectionedIndex = orderedSections.length;

  return [...items].sort((leftItem, rightItem) => {
    const leftSectionIndex = sectionIndexById.get(leftItem.question.exerciseSectionId ?? '') ?? unsectionedIndex;
    const rightSectionIndex = sectionIndexById.get(rightItem.question.exerciseSectionId ?? '') ?? unsectionedIndex;
    if (leftSectionIndex !== rightSectionIndex) return leftSectionIndex - rightSectionIndex;

    const leftOrder = leftItem.question.order ?? 0;
    const rightOrder = rightItem.question.order ?? 0;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;

    return leftItem.id.localeCompare(rightItem.id, undefined, { numeric: true });
  });
}

// Display-only rounding: summed fractional points (e.g. 0.1 + 0.2) carry floating-point
// artifacts; pass-percentage math keeps using the raw numeric values.
export function roundExercisePointsForDisplay(value: number | string | null | undefined): number {
  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue)) return 0;

  return Math.round(numericValue * 100) / 100;
}

export function formatExercisePoints(value: number | string | null | undefined): string {
  return String(roundExercisePointsForDisplay(value));
}

export function getTotalPossibleExercisePoints(questions: Question[]): number {
  return getActiveExerciseQuestions(questions).reduce((total, question) => total + Number(question.points ?? 0), 0);
}

export function getExerciseGradingSummary(
  questions: Question[],
  canonicalQuestions: CanonicalExerciseQuestionSummary[]
) {
  const activeQuestions = getActiveExerciseQuestions(questions);
  const manualCanonicalQuestions = canonicalQuestions.filter((question) => question.gradingMode !== 'auto');
  const questionCount = activeQuestions.length + canonicalQuestions.length;
  const canonicalPoints = canonicalQuestions.reduce((total, question) => total + Number(question.points ?? 0), 0);
  const isFullyAutoGradable =
    questionCount > 0 &&
    getManualGradedExerciseQuestions(activeQuestions).length === 0 &&
    manualCanonicalQuestions.length === 0;

  return {
    questionCount,
    totalPossiblePoints: getTotalPossibleExercisePoints(activeQuestions) + canonicalPoints,
    isFullyAutoGradable,
    manualCanonicalQuestions
  };
}

export function projectCanonicalQuestionsAfterMutations(
  canonicalQuestions: CanonicalExerciseQuestionSummary[],
  mutations: TAssessmentItemMutation[]
): CanonicalExerciseQuestionSummary[] {
  const projectedQuestions = new Map<string, CanonicalExerciseQuestionSummary>();

  for (const question of canonicalQuestions) {
    projectedQuestions.set(`question:${question.id}`, question);
  }

  for (const mutation of mutations) {
    const capabilities = deriveItemCapabilities(mutation.definition);
    const points = getItemMaxScore(mutation.definition);
    const id = mutation.action === 'publish' ? mutation.questionId : mutation.clientMutationId;
    const projectionKey = mutation.action === 'publish' ? `question:${mutation.questionId}` : `create:${id}`;

    projectedQuestions.set(projectionKey, {
      id,
      title: mutation.title,
      points,
      gradingMode: capabilities.gradingMode
    });
  }

  return [...projectedQuestions.values()];
}

export function getManualGradedExerciseQuestions(questions: Question[]): Question[] {
  return getActiveExerciseQuestions(questions).filter((question) => {
    const questionTypeId = Number(question.questionTypeId ?? question.questionType?.id);
    if (!Number.isFinite(questionTypeId)) return true;

    return !isAutoGradableQuestionTypeId(questionTypeId);
  });
}

function getSubmissionScore(submission: SubmissionListItem): number {
  const exactScore = Number((submission as SubmissionListItem & { score?: number | string | null }).score ?? NaN);
  if (Number.isFinite(exactScore)) return exactScore;

  const submissionTotal = Number((submission as SubmissionListItem & { total?: number | string | null }).total ?? NaN);
  if (Number.isFinite(submissionTotal)) return submissionTotal;

  return (submission.answers ?? []).reduce((total, answer) => total + Number(answer.score ?? answer.point ?? 0), 0);
}

export function shouldCompleteExerciseFromSubmission(params: {
  completionPolicy: ExerciseCompletionPolicy | null | undefined;
  passThreshold: number | null | undefined;
  totalPossiblePoints: number;
  submission: SubmissionListItem & { gradingState?: string | null };
}): boolean {
  if ((params.completionPolicy ?? 'submitted') === 'submitted') return true;
  if (params.submission.gradingState !== 'completed') return false;
  if (params.totalPossiblePoints <= 0) return false;

  const threshold = Number(params.passThreshold ?? 100);
  const scorePercent = (getSubmissionScore(params.submission) / params.totalPossiblePoints) * 100;

  return scorePercent >= threshold;
}

function getSubmissionTimestamp(submission: SubmissionListItem): number {
  const createdAt = (submission as SubmissionListItem & { createdAt?: string | Date | null }).createdAt;
  const timestamp = createdAt ? new Date(createdAt).getTime() : NaN;

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getStudentKey(submission: SubmissionListItem): string {
  const profile = submission.groupmember?.profile;
  const firstAnswerGroupMemberId = submission.answers?.find((answer) => answer.groupMemberId)?.groupMemberId;

  return String(profile?.id ?? firstAnswerGroupMemberId ?? submission.id);
}

export function groupSubmissionsByStudentAndAttempt(
  submissionItems: SubmissionListItem[]
): ExerciseSubmissionStudentGroup[] {
  const groupByStudent = new Map<string, SubmissionListItem[]>();

  for (const submission of submissionItems) {
    const studentKey = getStudentKey(submission);
    const studentSubmissions = groupByStudent.get(studentKey) ?? [];
    studentSubmissions.push(submission);
    groupByStudent.set(studentKey, studentSubmissions);
  }

  return [...groupByStudent.entries()]
    .map(([studentKey, studentSubmissions]) => {
      const orderedSubmissions = [...studentSubmissions].sort(
        (leftSubmission, rightSubmission) =>
          getSubmissionTimestamp(leftSubmission) - getSubmissionTimestamp(rightSubmission)
      );
      const latestSubmission = orderedSubmissions[orderedSubmissions.length - 1];
      const profile = latestSubmission?.groupmember?.profile;

      return {
        studentKey,
        studentName: profile?.fullname ?? '',
        studentAvatarUrl: profile?.avatarUrl ?? '',
        attempts: orderedSubmissions.map((submission, index) => ({
          attemptNumber: index + 1,
          submission
        }))
      };
    })
    .sort((leftGroup, rightGroup) => leftGroup.studentName.localeCompare(rightGroup.studentName));
}
