/**
 * What happens to a question's options and settings when a teacher changes its type.
 *
 * This is a lossy operation and always has been: switching to a type that takes no options
 * discards them, and switching to true/false or thumbs replaces whatever was there with a
 * fresh pair. Those are deliberate, but they were decided inside a store update in
 * `edit-mode.svelte` with nothing asserting them, so the difference between "discarded on
 * purpose" and "lost by accident" was not written down anywhere.
 *
 * The store update stays in the component. Only the decision moves here.
 */

import { QUESTION_TYPE_KEY } from '@cio/question-types';

import type { Question } from '$features/course/types';
import { questionTypeSupportsOptions } from './question-type-utils';
import type { QuestionTypeKey } from '@cio/question-types';

/**
 * The question's own option and settings types rather than a local copy of their shape —
 * a parallel definition would drift, and the store would reject the result.
 */
export type QuestionOption = NonNullable<Question['options']>[number];
export type QuestionSettings = Question['settings'];

export interface QuestionTypeTransitionInput {
  options: QuestionOption[];
  settings: QuestionSettings;
}

export interface QuestionTypeTransitionResult {
  options: QuestionOption[];
  settings: QuestionSettings;
}

/** Ids carry a timestamp so a freshly added option is distinguishable from a saved one. */
export function makeDefaultOption(now: number = Date.now()): QuestionOption {
  return { id: `${now}-form`, label: '', value: '', isCorrect: false };
}

export function makeTrueFalseOptions(correctValue = true, now: number = Date.now()): QuestionOption[] {
  return [
    { id: `${now}-true-form`, label: 'True', value: 'true', isCorrect: correctValue },
    { id: `${now}-false-form`, label: 'False', value: 'false', isCorrect: !correctValue }
  ];
}

/** Thumbs has no correct answer: it is a reaction, not a question with a key. */
export function makeThumbsOptions(now: number = Date.now()): QuestionOption[] {
  return [
    { id: `${now}-yes-form`, label: 'Yes', value: 'true', isCorrect: false },
    { id: `${now}-no-form`, label: 'No', value: 'false', isCorrect: false }
  ];
}

/**
 * The options and settings a question should have after its type changes.
 *
 * Four shapes, in the order the original branched:
 *
 * - **true/false** — a fresh pair, keeping whichever side was already marked correct.
 * - **thumbs** — a fresh pair with no correct side.
 * - **any other type that takes options** — existing options are *kept*, and an empty one is
 *   added only when nothing usable is left, so a teacher switching between two option-taking
 *   types does not lose what they typed.
 * - **anything else** — options are dropped, because the type cannot show them.
 *
 * Video recording then adds its own defaults on top, whatever the branch above decided.
 */
export function applyQuestionTypeChange(
  current: QuestionTypeTransitionInput,
  nextQuestionTypeKey: QuestionTypeKey,
  now: number = Date.now()
): QuestionTypeTransitionResult {
  let options = current.options ?? [];
  let settings: QuestionSettings = current.settings ?? {};

  if (nextQuestionTypeKey === QUESTION_TYPE_KEY.TRUE_FALSE) {
    const correctValue = (settings as { correctValue?: boolean }).correctValue ?? true;
    settings = { ...settings, correctValue };
    options = makeTrueFalseOptions(correctValue, now);
  } else if (nextQuestionTypeKey === QUESTION_TYPE_KEY.THUMBS) {
    settings = { ...settings };
    options = makeThumbsOptions(now);
  } else if (questionTypeSupportsOptions(nextQuestionTypeKey)) {
    const hasActiveOptions = options.some((option) => !option.deletedAt);
    if (!hasActiveOptions) options = [...options, makeDefaultOption(now)];
  } else {
    options = [];
  }

  if (nextQuestionTypeKey === QUESTION_TYPE_KEY.VIDEO_RECORDING) {
    settings = { ...settings, maxDurationSeconds: 60, allowRetakes: true };
  }

  return { options, settings };
}
