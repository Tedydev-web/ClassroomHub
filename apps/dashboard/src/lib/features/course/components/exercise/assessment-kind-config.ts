/**
 * The authoring rules for word bank and ordering, lifted out of the composer.
 *
 * The composer is 2,175 lines and the spec for these two kinds said they should not arrive as
 * more branches inside it. They did, and this is the half of that mistake worth undoing now:
 * the rules that decide what the next config looks like are pure, so they belong in a module
 * with tests rather than inside a `.svelte` file where the only way to check them is to open
 * the screen. The markup stays where it is until someone can look at the result of moving it.
 *
 * Every function returns a new config and never mutates its argument, which is what lets the
 * composer keep replacing state wholesale.
 */

import type { AssessmentInteraction } from '@cio/question-types';

type WordBankConfig = Extract<AssessmentInteraction, { kind: 'word_bank' }>['config'];
type OrderingConfig = Extract<AssessmentInteraction, { kind: 'ordering' }>['config'];

/** Blanks are three or more underscores, matching what validation counts. */
const BLANK_PATTERN = /_{3,}/g;

export function countTemplateBlanks(template: string): number {
  return (template.match(BLANK_PATTERN) ?? []).length;
}

/**
 * One answer field per `___` in the template.
 *
 * Authors add and remove blanks by editing the sentence, so the answer list has to follow it
 * rather than be maintained separately — otherwise a removed blank leaves an orphan answer that
 * validation then rejects, and the author has no field on screen to explain it.
 *
 * A template with no blank keeps one answer field rather than none: validation already asks for
 * a blank, and an empty answer section on top of that message says nothing extra.
 */
export function syncWordBankAnswers(config: WordBankConfig): WordBankConfig {
  const blankCount = Math.max(1, countTemplateBlanks(config.template));
  if (config.correctAnswers.length === blankCount) return config;

  return {
    ...config,
    correctAnswers: Array.from({ length: blankCount }, (_, index) => config.correctAnswers[index] ?? '')
  };
}

export function addWordBankDistractor(config: WordBankConfig, maximum: number): WordBankConfig {
  if (config.distractors.length >= maximum) return config;

  return { ...config, distractors: [...config.distractors, ''] };
}

export function removeWordBankDistractor(config: WordBankConfig, distractorIndex: number): WordBankConfig {
  return { ...config, distractors: config.distractors.filter((_, index) => index !== distractorIndex) };
}

/**
 * The authored list order is the correct order, so both are rewritten together and cannot drift
 * apart. Validation requires `correctOrder` to be an exact permutation of the options, and every
 * function here maintains that by construction rather than by remembering to.
 */
function withOrder(config: OrderingConfig, options: OrderingConfig['options']): OrderingConfig {
  return { ...config, options, correctOrder: options.map((option) => option.id) };
}

export function moveOrderingOption(config: OrderingConfig, index: number, direction: 1 | -1): OrderingConfig {
  const target = index + direction;
  if (index < 0 || index >= config.options.length || target < 0 || target >= config.options.length) return config;

  const options = [...config.options];
  [options[index], options[target]] = [options[target], options[index]];

  return withOrder(config, options);
}

export function addOrderingOption(config: OrderingConfig, optionId: string, maximum: number): OrderingConfig {
  if (config.options.length >= maximum) return config;

  return withOrder(config, [...config.options, { id: optionId, html: '' }]);
}

/**
 * Two options is the minimum validation accepts, so removing below that is refused here rather
 * than allowed and then reported as a violation the author cannot act on.
 */
export function removeOrderingOption(config: OrderingConfig, optionId: string): OrderingConfig {
  if (config.options.length <= 2) return config;

  return withOrder(
    config,
    config.options.filter((option) => option.id !== optionId)
  );
}
