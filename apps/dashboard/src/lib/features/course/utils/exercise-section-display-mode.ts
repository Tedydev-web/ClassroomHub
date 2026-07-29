import type { ExerciseSectionDisplayMode } from '@cio/question-types';

export type LearnerSectionQuestionDisplay = Exclude<ExerciseSectionDisplayMode, 'learner_choice'>;

export function resolveLearnerSectionQuestionDisplay(
  sectionDisplayMode: ExerciseSectionDisplayMode,
  learnerPreference: LearnerSectionQuestionDisplay
): LearnerSectionQuestionDisplay {
  return sectionDisplayMode === 'learner_choice' ? learnerPreference : sectionDisplayMode;
}

export function getLearnerSectionQuestionDisplayStorageKey(exerciseId: string): string {
  return `exercise-section-question-display:${exerciseId}`;
}
