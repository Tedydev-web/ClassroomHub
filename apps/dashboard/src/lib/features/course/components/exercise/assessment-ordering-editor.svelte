<script lang="ts">
  /**
   * Ordering authoring, out of the composer.
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
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
  import { flip } from 'svelte/animate';
  import { MOTION_DURATION, motionDuration } from '$lib/utils/motion';
  import { addOrderingOption, moveOrderingOption, removeOrderingOption } from './assessment-kind-config';

  interface Props {
    block: AssessmentInteractionBlock;
    blockIndex: number;
    getBlockDomId: (blockId: string, field: string) => string;
    getValidationError: (path: Array<string | number>, required?: boolean) => string;
    clearValidationState: () => void;
    updateOrderingConfig: (
      blockId: string,
      next: (
        config: Extract<AssessmentInteraction, { kind: 'ordering' }>['config']
      ) => Extract<AssessmentInteraction, { kind: 'ordering' }>['config']
    ) => void;
    createId: () => string;
  }

  let {
    block,
    blockIndex,
    getBlockDomId,
    getValidationError,
    clearValidationState,
    updateOrderingConfig,
    createId
  }: Props = $props();
</script>

{#if block.interaction.kind === 'ordering'}
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
    onInput={clearValidationState}
  />
  <Field.Set>
    <Field.Legend>
      {$t('course.navItem.lessons.exercises.all_exercises.shared_question.ordering.edit.helper')}
    </Field.Legend>
    <Field.Group>
      {#each block.interaction.config.options as option, optionIndex (option.id)}
        <!-- The list order is the answer key, so a step that jumps on reorder loses the author's
             place in the very thing they are setting. -->
        <div class="flex items-end gap-2" animate:flip={{ duration: motionDuration(MOTION_DURATION.fast) }}>
          <InputField
            bind:value={block.interaction.config.options[optionIndex].html}
            name={getBlockDomId(block.id, `ordering-option-${option.id}`)}
            label={$t('course.navItem.lessons.exercises.all_exercises.shared_question.ordering.edit.step_placeholder', {
              index: optionIndex + 1
            })}
            errorMessage={getValidationError([
              'blocks',
              blockIndex,
              'interaction',
              'config',
              'options',
              optionIndex,
              'html'
            ])}
            onInput={clearValidationState}
          />
          <IconButton
            type="button"
            variant="secondary"
            disabled={optionIndex === 0}
            label={$t('course.navItem.lessons.exercises.all_exercises.section.move_up')}
            onclick={() => updateOrderingConfig(block.id, (config) => moveOrderingOption(config, optionIndex, -1))}
          >
            <ChevronUpIcon class="h-4 w-4" />
          </IconButton>
          <IconButton
            type="button"
            variant="secondary"
            disabled={optionIndex === block.interaction.config.options.length - 1}
            label={$t('course.navItem.lessons.exercises.all_exercises.section.move_down')}
            onclick={() => updateOrderingConfig(block.id, (config) => moveOrderingOption(config, optionIndex, 1))}
          >
            <ChevronDownIcon class="h-4 w-4" />
          </IconButton>
          {#if block.interaction.config.options.length > 2}
            <IconButton
              type="button"
              variant="secondary"
              label={$t(
                'course.navItem.lessons.exercises.all_exercises.shared_question.ordering.edit.remove_step_tooltip'
              )}
              onclick={() => updateOrderingConfig(block.id, (config) => removeOrderingOption(config, option.id))}
            >
              <TrashIcon class="h-4 w-4" />
            </IconButton>
          {/if}
        </div>
      {/each}
    </Field.Group>
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={block.interaction.config.options.length >= MAX_INTERACTION_OPTIONS}
      onclick={() =>
        updateOrderingConfig(block.id, (config) => addOrderingOption(config, createId(), MAX_INTERACTION_OPTIONS))}
    >
      <PlusIcon class="h-4 w-4" />
      {$t('course.navItem.lessons.exercises.all_exercises.shared_question.ordering.edit.add_step')}
    </Button>
  </Field.Set>
{/if}
