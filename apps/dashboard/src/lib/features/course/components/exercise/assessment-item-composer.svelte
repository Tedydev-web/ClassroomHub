<script lang="ts">
  import { onMount } from 'svelte';
  import { TextEditor } from '$features/ui';
  import { exerciseApi } from '$features/course/api';
  import { t } from '$lib/utils/functions/translations';
  import { snackbar } from '$features/ui/snackbar/store';
  import { Button } from '@cio/ui/base/button';
  import { AssessmentItemRenderer } from '@cio/ui/custom/exercise-question';
  import { Checkbox } from '@cio/ui/base/checkbox';
  import { InputField } from '@cio/ui/custom/input-field';
  import { IconButton } from '@cio/ui/custom/icon-button';
  import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
  import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import TrashIcon from '@lucide/svelte/icons/trash';
  import { toAssessmentDeliveryDefinition, type AssessmentItemDefinition } from '@cio/question-types';
  import {
    addChoiceInteractionBlock,
    addContentBlock,
    addTextInteractionBlock,
    createAssessmentComposerState,
    removeAssessmentBlock,
    reorderAssessmentBlock,
    type AssessmentComposerState
  } from '$features/course/utils/assessment-composer-state';

  interface Props {
    courseId: string;
    exerciseId: string;
    questionId?: number;
    initialTitle?: string;
    onSaved?: (item: { questionId: number; title: string; points: number }) => Promise<void> | void;
  }

  let { courseId, exerciseId, questionId, initialTitle = '', onSaved = () => {} }: Props = $props();
  let composer = $state<AssessmentComposerState>(createAssessmentComposerState());
  let title = $state('');
  let revision = $state(0);
  let isLoading = $state(false);
  let isSaving = $state(false);

  function createId(): string {
    return crypto.randomUUID();
  }

  function updateDefinition(nextDefinition: AssessmentItemDefinition) {
    composer = { ...composer, definition: nextDefinition };
  }

  function updateBlock(
    blockId: string,
    update: (block: AssessmentItemDefinition['blocks'][number]) => AssessmentItemDefinition['blocks'][number]
  ) {
    updateDefinition({
      ...composer.definition,
      blocks: composer.definition.blocks.map((block) => (block.id === blockId ? update(block) : block))
    });
  }

  function moveBlock(blockId: string, offset: -1 | 1) {
    const sourceIndex = composer.definition.blocks.findIndex((block) => block.id === blockId);
    if (sourceIndex < 0) return;

    composer = reorderAssessmentBlock(composer, blockId, sourceIndex + offset);
  }

  function addChoiceOption(blockId: string) {
    updateBlock(blockId, (block) => {
      if (block.kind !== 'interaction' || block.interaction.kind !== 'choice') return block;

      return {
        ...block,
        interaction: {
          ...block.interaction,
          config: {
            ...block.interaction.config,
            options: [...block.interaction.config.options, { id: createId(), html: '' }]
          }
        }
      };
    });
  }

  function removeChoiceOption(blockId: string, optionId: string) {
    updateBlock(blockId, (block) => {
      if (block.kind !== 'interaction' || block.interaction.kind !== 'choice') return block;

      return {
        ...block,
        interaction: {
          ...block.interaction,
          config: {
            ...block.interaction.config,
            options: block.interaction.config.options.filter((option) => option.id !== optionId),
            correctOptionIds: block.interaction.config.correctOptionIds.filter(
              (correctOptionId) => correctOptionId !== optionId
            )
          }
        }
      };
    });
  }

  function toggleCorrectOption(blockId: string, optionId: string, checked: boolean) {
    updateBlock(blockId, (block) => {
      if (block.kind !== 'interaction' || block.interaction.kind !== 'choice') return block;

      const correctOptionIds = checked
        ? [...block.interaction.config.correctOptionIds, optionId]
        : block.interaction.config.correctOptionIds.filter((correctOptionId) => correctOptionId !== optionId);
      return {
        ...block,
        interaction: {
          ...block.interaction,
          config: { ...block.interaction.config, correctOptionIds }
        }
      };
    });
  }

  async function loadExistingItem() {
    title = initialTitle;
    if (!questionId) return;

    isLoading = true;
    try {
      const result = await exerciseApi.getAssessmentItem(courseId, exerciseId, questionId);
      if (!result?.data) return;

      composer = { definition: result.data.definition as AssessmentItemDefinition, selectedBlockId: null };
      revision = result.data.revision;
    } finally {
      isLoading = false;
    }
  }

  async function save() {
    if (isSaving) return;

    isSaving = true;
    try {
      const result = questionId
        ? await exerciseApi.publishAssessmentItem(courseId, exerciseId, questionId, {
            expectedRevision: revision,
            definition: composer.definition
          })
        : await exerciseApi.createAssessmentItem(courseId, exerciseId, { title, definition: composer.definition });
      if (!result?.data) return;

      revision = result.data.revision;
      snackbar.success(t.get('course.navItem.lessons.exercises.all_exercises.assessment_item.saved'));
      const points = composer.definition.blocks.reduce(
        (total, block) => total + (block.kind === 'interaction' ? block.interaction.maxScore : 0),
        0
      );
      await onSaved({ questionId: result.data.questionId, title, points });
    } finally {
      isSaving = false;
    }
  }

  onMount(loadExistingItem);
</script>

<section class="space-y-4 rounded-md border p-4">
  {#if !questionId}
    <InputField
      bind:value={title}
      label={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.title')}
      placeholder={$t('course.navItem.lessons.exercises.all_exercises.write_your_question_here')}
    />
  {/if}

  {#if isLoading}
    <div class="ui:animate-pulse ui:h-24 ui:rounded ui:bg-muted"></div>
  {:else}
    <div class="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onclick={() => (composer = addContentBlock(composer, createId))}
      >
        <PlusIcon class="h-4 w-4" />
        {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.add_content')}
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onclick={() => (composer = addChoiceInteractionBlock(composer, createId))}
      >
        <PlusIcon class="h-4 w-4" />
        {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.add_choice')}
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onclick={() => (composer = addTextInteractionBlock(composer, createId))}
      >
        <PlusIcon class="h-4 w-4" />
        {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.add_text')}
      </Button>
    </div>

    {#each composer.definition.blocks as block, blockIndex (block.id)}
      <div class="space-y-4 rounded border p-4">
        <div class="flex items-center justify-end gap-1">
          <IconButton
            variant="secondary"
            disabled={blockIndex === 0}
            onclick={() => moveBlock(block.id, -1)}
            tooltip={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.move_up')}
          >
            <ArrowUpIcon class="h-4 w-4" />
          </IconButton>
          <IconButton
            variant="secondary"
            disabled={blockIndex === composer.definition.blocks.length - 1}
            onclick={() => moveBlock(block.id, 1)}
            tooltip={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.move_down')}
          >
            <ArrowDownIcon class="h-4 w-4" />
          </IconButton>
          <IconButton
            variant="secondary"
            onclick={() => (composer = removeAssessmentBlock(composer, block.id))}
            tooltip={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.remove')}
          >
            <TrashIcon class="h-4 w-4" />
          </IconButton>
        </div>

        {#if block.kind === 'content'}
          <TextEditor
            content={block.content.html}
            placeholder={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.content_placeholder')}
            onChange={(content) =>
              updateBlock(block.id, (currentBlock) =>
                currentBlock.kind === 'content'
                  ? { ...currentBlock, content: { ...currentBlock.content, html: `${content}` } }
                  : currentBlock
              )}
          />
        {:else if block.interaction.kind === 'choice'}
          <InputField
            value={block.interaction.prompt.html}
            label={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.prompt')}
            oninput={(event) =>
              updateBlock(block.id, (currentBlock) =>
                currentBlock.kind === 'interaction' && currentBlock.interaction.kind === 'choice'
                  ? {
                      ...currentBlock,
                      interaction: {
                        ...currentBlock.interaction,
                        prompt: { ...currentBlock.interaction.prompt, html: event.currentTarget.value }
                      }
                    }
                  : currentBlock
              )}
          />
          <InputField
            value={block.interaction.maxScore}
            label={$t('course.navItem.lessons.exercises.new_exercise_modal.points')}
            type="number"
            min="0"
            step="0.01"
            oninput={(event) =>
              updateBlock(block.id, (currentBlock) => {
                if (currentBlock.kind !== 'interaction' || currentBlock.interaction.kind !== 'choice')
                  return currentBlock;
                const maxScore = Number(event.currentTarget.value);
                return Number.isFinite(maxScore)
                  ? { ...currentBlock, interaction: { ...currentBlock.interaction, maxScore } }
                  : currentBlock;
              })}
          />
          <div class="space-y-2">
            {#each block.interaction.config.options as option, optionIndex (option.id)}
              <div class="flex items-center gap-2">
                <Checkbox
                  checked={block.interaction.config.correctOptionIds.includes(option.id)}
                  onCheckedChange={(checked) => toggleCorrectOption(block.id, option.id, checked === true)}
                />
                <InputField
                  value={option.html}
                  aria-label={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.option', {
                    index: optionIndex + 1
                  })}
                  oninput={(event) =>
                    updateBlock(block.id, (currentBlock) => {
                      if (currentBlock.kind !== 'interaction' || currentBlock.interaction.kind !== 'choice') {
                        return currentBlock;
                      }
                      return {
                        ...currentBlock,
                        interaction: {
                          ...currentBlock.interaction,
                          config: {
                            ...currentBlock.interaction.config,
                            options: currentBlock.interaction.config.options.map((currentOption) =>
                              currentOption.id === option.id
                                ? { ...currentOption, html: event.currentTarget.value }
                                : currentOption
                            )
                          }
                        }
                      };
                    })}
                />
                <IconButton
                  variant="secondary"
                  disabled={block.interaction.config.options.length <= 2}
                  onclick={() => removeChoiceOption(block.id, option.id)}
                  tooltip={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.remove')}
                >
                  <TrashIcon class="h-4 w-4" />
                </IconButton>
              </div>
            {/each}
          </div>
          <Button type="button" variant="secondary" size="sm" onclick={() => addChoiceOption(block.id)}>
            <PlusIcon class="h-4 w-4" />
            {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.add_option')}
          </Button>
        {:else if block.interaction.kind === 'text'}
          <TextEditor
            content={block.interaction.prompt.html}
            placeholder={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.prompt')}
            onChange={(content) =>
              updateBlock(block.id, (currentBlock) =>
                currentBlock.kind === 'interaction' && currentBlock.interaction.kind === 'text'
                  ? {
                      ...currentBlock,
                      interaction: {
                        ...currentBlock.interaction,
                        prompt: { ...currentBlock.interaction.prompt, html: `${content}` }
                      }
                    }
                  : currentBlock
              )}
          />
          <InputField
            value={block.interaction.maxScore}
            label={$t('course.navItem.lessons.exercises.new_exercise_modal.points')}
            type="number"
            min="0"
            step="0.01"
            oninput={(event) =>
              updateBlock(block.id, (currentBlock) => {
                if (currentBlock.kind !== 'interaction' || currentBlock.interaction.kind !== 'text')
                  return currentBlock;
                const maxScore = Number(event.currentTarget.value);
                return Number.isFinite(maxScore)
                  ? { ...currentBlock, interaction: { ...currentBlock.interaction, maxScore } }
                  : currentBlock;
              })}
          />
        {/if}
      </div>
    {/each}

    <Button type="button" onclick={save} disabled={isSaving} loading={isSaving}>
      {$t('course.navItem.lessons.exercises.all_exercises.assessment_item.save')}
    </Button>

    {#if composer.definition.blocks.length > 0}
      <div class="space-y-3 border-t pt-4">
        <p class="ui:text-muted-foreground text-sm">
          {$t('course.navItem.lessons.exercises.all_exercises.preview')}
        </p>
        <AssessmentItemRenderer definition={toAssessmentDeliveryDefinition(composer.definition)} disabled />
      </div>
    {/if}
  {/if}
</section>
