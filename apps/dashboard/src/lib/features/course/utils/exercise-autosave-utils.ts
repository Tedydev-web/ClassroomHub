import {
  decodeStoredAnswerData,
  getExerciseQuestionContractKey,
  isRecord,
  parseJsonRecord,
  type AnswerData,
  type ExerciseQuestionModel
} from '@cio/question-types';

import type { QuestionnaireMetaData } from '../components/exercise/store';

export interface ParseExerciseAutosaveInput {
  serializedValue: string;
  exerciseId: string;
  questions: ExerciseQuestionModel[];
  sectionCount: number;
}

export interface HistoricalSubmissionHydrationInput {
  hasRestoredUnfinishedDraft: boolean;
  skipHydration: boolean;
  isExerciseLoaded: boolean;
  hasSubmissions: boolean;
  isFinished: boolean;
}

function readFiniteNumberRecord(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;

  const result: Record<string, number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'number' || !Number.isFinite(item)) return null;

    result[key] = item;
  }

  return result;
}

export function parseExerciseAutosave({
  serializedValue,
  exerciseId,
  questions,
  sectionCount
}: ParseExerciseAutosaveInput): QuestionnaireMetaData | null {
  const parsed = parseJsonRecord(serializedValue);
  if (!parsed || !isRecord(parsed.answers)) return null;

  const scores = readFiniteNumberRecord(parsed.scores);
  const grades = readFiniteNumberRecord(parsed.grades);
  if (!scores || !grades) return null;

  const currentSectionIndex = parsed.currentSectionIndex ?? 0;
  const sectionPhase = parsed.sectionPhase ?? 'questions';
  const storedExerciseId = parsed.exerciseId ?? null;
  if (
    typeof parsed.totalPossibleGrade !== 'number' ||
    !Number.isFinite(parsed.totalPossibleGrade) ||
    typeof parsed.finalTotalGrade !== 'number' ||
    !Number.isFinite(parsed.finalTotalGrade) ||
    typeof parsed.currentQuestionIndex !== 'number' ||
    !Number.isSafeInteger(parsed.currentQuestionIndex) ||
    parsed.currentQuestionIndex < 0 ||
    parsed.currentQuestionIndex > questions.length + 1 ||
    typeof parsed.isFinished !== 'boolean' ||
    typeof parsed.progressValue !== 'number' ||
    !Number.isFinite(parsed.progressValue) ||
    parsed.progressValue < 0 ||
    parsed.progressValue > 100 ||
    typeof parsed.status !== 'number' ||
    !Number.isSafeInteger(parsed.status) ||
    typeof parsed.comment !== 'string' ||
    (storedExerciseId !== null && typeof storedExerciseId !== 'string') ||
    (storedExerciseId !== null && storedExerciseId !== exerciseId) ||
    typeof currentSectionIndex !== 'number' ||
    !Number.isSafeInteger(currentSectionIndex) ||
    currentSectionIndex < 0 ||
    currentSectionIndex > Math.max(0, sectionCount - 1) ||
    (sectionPhase !== 'overview' && sectionPhase !== 'questions')
  ) {
    return null;
  }

  const questionByKey = new Map(questions.map((question) => [getExerciseQuestionContractKey(question), question]));
  const answers: Record<string, AnswerData | undefined> = {};
  for (const [questionKey, storedAnswer] of Object.entries(parsed.answers)) {
    const question = questionByKey.get(questionKey);
    if (!question) continue;

    const answer = decodeStoredAnswerData(storedAnswer, question);
    if (answer) answers[questionKey] = answer;
  }

  return {
    answers,
    scores,
    grades,
    totalPossibleGrade: parsed.totalPossibleGrade,
    finalTotalGrade: parsed.finalTotalGrade,
    currentQuestionIndex: parsed.currentQuestionIndex,
    isFinished: parsed.isFinished,
    progressValue: parsed.progressValue,
    status: parsed.status,
    comment: parsed.comment,
    exerciseId: storedExerciseId,
    currentSectionIndex,
    sectionPhase
  };
}

export function shouldHydrateHistoricalSubmission({
  hasRestoredUnfinishedDraft,
  skipHydration,
  isExerciseLoaded,
  hasSubmissions,
  isFinished
}: HistoricalSubmissionHydrationInput): boolean {
  return !hasRestoredUnfinishedDraft && !skipHydration && isExerciseLoaded && hasSubmissions && !isFinished;
}
