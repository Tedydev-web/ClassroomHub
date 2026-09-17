<script lang="ts">
  /**
   * Word bank authoring, out of the composer.
   *
   * `interaction-kinds-spec.md` asked for a new kind to arrive as its own component rather than
   * as more branches in a file that was already 1,840 lines. It did not, and the file reached
   * 2,175. This is the markup half of that repair; the rules moved to `assessment-kind-config.ts`
   * earlier.
   *
   * The `{#if}` guard stays inside rather than in the caller, so the narrowing the markup relies
   * on is the same narrowing it had in the composer — the extraction moves lines, it does not
   * re-derive types. `block` is the composer's own `$state` object, so `bind:` writes to exactly
   * the object the composer reads, as before.
   */
  import { Button } from '@cio/ui/base/button';
  import * as Field from '@cio/ui/base/field';
  import { IconButton } from '@cio/ui/custom/icon-button';
  import { InputField } from '@cio/ui/custom/input-field';
  import { RichTextField } from '$features/ui';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import TrashIcon from '@lucide/svelte/icons/trash';
  import { MAX_INTERACTION_OPTIONS } from '@cio/question-types';
  import type { AssessmentInteraction, AssessmentInteractionBlock } from '@cio/question-types';
  import { t } from '$lib/utils/functions/translations';
  import { addWordBankDistractor, removeWordBankDistractor, syncWordBankAnswers } from './assessment-kind-config';

  interface Props {
    block: AssessmentInteractionBlock;
    blockIndex: number;
    getBlockDomId: (blockId: string, field: string) => string;
    getValidationError: (path: Array<string | number>, required?: boolean) => string;
    clearValidationState: () => void;
    updateWordBankConfig: (
      blockId: string,
      next: (
        config: Extract<AssessmentInteraction, { kind: 'word_bank' }>['config']
      ) => Extract<AssessmentInteraction, { kind: 'word_bank' }>['config']
    ) => void;
  }

  let { block, blockIndex, getBlockDomId, getValidationError, clearValidationState, updateWordBankConfig }: Props =
    $props();
</script>

{#if block.interaction.kind === 'word_bank'}
  <RichTextField
    bind:value={block.interaction.prompt.html}
    name={getBlockDomId(block.id, 'prompt')}
    label={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.prompt')}
    errorMessage={getValidationError(['blocks', blockIndex, 'interaction', 'prompt'], true)}
    oninput={clearValidationState}
  />
  <InputField
    bind:value={block.interaction.maxScore}
    name={getBlockDomId(block.id, 'points')}
    label={$t('course.navItem.lessons.exercises.new_exercise_modal.points')}
    type="number"
    min="0"
    step="0.01"
    oninput={clearValidationState}
  />
  <InputField
    bind:value={block.interaction.config.template}
    name={getBlockDomId(block.id, 'template')}
    label={$t('course.navItem.lessons.exercises.all_exercises.shared_question.word_bank.edit.template_label')}
    placeholder={$t(
      'course.navItem.lessons.exercises.all_exercises.shared_question.word_bank.edit.template_placeholder'
    )}
    errorMessage={getValidationError(['blocks', blockIndex, 'interaction', 'config', 'template'])}
    oninput={() => {
      clearValidationState();
      updateWordBankConfig(block.id, syncWordBankAnswers);
    }}
  />
  <p class="ui:text-muted-foreground text-xs">
    {$t('course.navItem.lessons.exercises.all_exercises.shared_question.word_bank.edit.template_helper')}
  </p>
  <Field.Set>
    <Field.Legend>
      {$t('course.navItem.lessons.exercises.all_exercises.shared_question.word_bank.edit.correct_answers_heading')}
    </Field.Legend>
    <Field.Group class="grid gap-4 sm:grid-cols-2">
      {#each block.interaction.config.correctAnswers as _answer, answerIndex (answerIndex)}
        <InputField
          bind:value={block.interaction.config.correctAnswers[answerIndex]}
          name={getBlockDomId(block.id, `word-bank-answer-${answerIndex}`)}
          label={`${$t('course.navItem.lessons.exercises.all_exercises.shared_question.word_bank.edit.blank_label')} ${answerIndex + 1}`}
          placeholder={$t(
            'course.navItem.lessons.exercises.all_exercises.shared_question.word_bank.edit.correct_placeholder'
          )}
          errorMessage={getValidationError([
            'blocks',
            blockIndex,
            'interaction',
            'config',
            'correctAnswers',
            answerIndex
          ])}
          oninput={clearValidationState}
        />
      {/each}
    </Field.Group>
  </Field.Set>
  <Field.Set>
    <Field.Legend>
      {$t('course.navItem.lessons.exercises.all_exercises.shared_question.word_bank.edit.distractors_heading')}
    </Field.Legend>
    <Field.Group class="grid gap-4 sm:grid-cols-2">
      {#each block.interaction.config.distractors as _distractor, distractorIndex (distractorIndex)}
        <div class="flex items-end gap-2">
          <InputField
            bind:value={block.interaction.config.distractors[distractorIndex]}
            name={getBlockDomId(block.id, `word-bank-distractor-${distractorIndex}`)}
            label={`${$t('course.navItem.lessons.exercises.all_exercises.shared_question.word_bank.edit.distractor_placeholder')} ${distractorIndex + 1}`}
            oninput={clearValidationState}
          />
          <IconButton
            type="button"
            variant="secondary"
            label={$t('common.remove')}
            onclick={() =>
              updateWordBankConfig(block.id, (config) => removeWordBankDistractor(config, distractorIndex))}
          >
            <TrashIcon class="h-4 w-4" />
          </IconButton>
        </div>
      {/each}
    </Field.Group>
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={block.interaction.config.distractors.length >= MAX_INTERACTION_OPTIONS}
      onclick={() => updateWordBankConfig(block.id, (config) => addWordBankDistractor(config, MAX_INTERACTION_OPTIONS))}
    >
      <PlusIcon class="h-4 w-4" />
      {$t('course.navItem.lessons.exercises.all_exercises.shared_question.word_bank.edit.add_distractor')}
    </Button>
  </Field.Set>
{/if}
