<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ExerciseSectionColorTheme } from '@cio/question-types';
  import { Button } from '@cio/ui/base/button';
  import { IconButton } from '@cio/ui/custom/icon-button';
  import { RichTextField } from '$features/ui';
  import GripVerticalIcon from '@lucide/svelte/icons/grip-vertical';
  import XIcon from '@lucide/svelte/icons/x';
  import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
  import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
  import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';

  const COLOR_THEMES: ExerciseSectionColorTheme[] = ['blue', 'green', 'amber', 'rose', 'violet', 'slate'];

  const COLOR_CLASSES: Record<ExerciseSectionColorTheme, string> = {
    blue: 'bg-blue-500',
    green: 'bg-emerald-500',
    amber: 'bg-amber-500',
    rose: 'bg-rose-500',
    violet: 'bg-violet-500',
    slate: 'bg-slate-500'
  };

  const BORDER_CLASSES: Record<ExerciseSectionColorTheme, string> = {
    blue: 'border-blue-500',
    green: 'border-emerald-500',
    amber: 'border-amber-500',
    rose: 'border-rose-500',
    violet: 'border-violet-500',
    slate: 'border-slate-500'
  };

  interface Props {
    exerciseSectionId: string;
    title: string;
    description?: string | null;
    sectionNumber: number;
    totalSections: number;
    colorTheme: ExerciseSectionColorTheme;
    questionCount: number;
    requiredQuestionCount: number;
    titleError?: string;
    descriptionError?: string;
    showReorderHandles?: boolean;
    onTitleChange?: (title: string) => void;
    onDescriptionChange?: (description: string | null) => void;
    onColorThemeChange?: (colorTheme: ExerciseSectionColorTheme) => void;
    onAddQuestion?: () => void;
    onDelete?: () => void;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    canMoveUp?: boolean;
    canMoveDown?: boolean;
    labels?: Record<string, string>;
    children?: Snippet;
  }

  let {
    exerciseSectionId,
    title,
    description = null,
    colorTheme,
    questionCount,
    requiredQuestionCount,
    titleError = '',
    descriptionError = '',
    showReorderHandles = false,
    onTitleChange,
    onDescriptionChange,
    onColorThemeChange,
    onAddQuestion,
    onDelete,
    onMoveUp,
    onMoveDown,
    canMoveUp = false,
    canMoveDown = false,
    labels = {},
    children
  }: Props = $props();

  let localTitle = $derived(title);
  let localDescription = $derived(description ?? '');

  let sectionCollapsed = $state(false);

  function handleTitleInput() {
    onTitleChange?.(localTitle);
  }

  function handleDescriptionInput() {
    onDescriptionChange?.(localDescription || null);
  }
</script>

<section
  id={`exercise-section-${exerciseSectionId}`}
  class={`ui:bg-card overflow-hidden rounded-lg border shadow-xs ${BORDER_CLASSES[colorTheme]}`}
  aria-expanded={!sectionCollapsed}
>
  <!-- `items-start`: an imported paper puts its rubric in the section title — the
       ones on this deployment run 148 to 207 characters — and a rubric that wraps
       to five lines left the colour swatches, the count and the delete button
       floating in the middle of it. They belong beside the first line. -->
  <div class="group/sectionhead ui:bg-muted flex items-start gap-3 border-b px-4 py-3">
    {#if showReorderHandles}
      <GripVerticalIcon class="ui:text-muted-foreground h-4 w-4 shrink-0" aria-hidden="true" />
    {/if}
    <div class="relative h-7 w-7 shrink-0">
      {#if !sectionCollapsed}
        <span
          class={`pointer-events-none absolute top-1/2 left-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-100 transition-opacity ${COLOR_CLASSES[colorTheme]} group-hover/sectionhead:opacity-0`}
          aria-hidden="true"
        ></span>
        <div
          class="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover/sectionhead:opacity-100"
        >
          <IconButton
            type="button"
            variant="ghost"
            size="icon-sm"
            onclick={() => (sectionCollapsed = true)}
            tooltip={labels.collapseSection ?? 'Collapse section'}
            tooltipSide="bottom"
            class="shrink-0"
          >
            <ChevronUpIcon class="h-4 w-4" aria-hidden="true" />
          </IconButton>
        </div>
      {:else}
        <div class="flex h-full w-full items-center justify-center">
          <IconButton
            type="button"
            variant="ghost"
            size="icon-sm"
            onclick={() => (sectionCollapsed = false)}
            tooltip={labels.expandSection ?? 'Expand section'}
            tooltipSide="bottom"
            class="shrink-0"
          >
            <ChevronDownIcon class="h-4 w-4" aria-hidden="true" />
          </IconButton>
        </div>
      {/if}
    </div>
    <RichTextField
      bind:value={localTitle}
      name={`exercise-section-${exerciseSectionId}-title`}
      variant="inline"
      aria-label={labels.title ?? 'Section title'}
      oninput={handleTitleInput}
      errorMessage={titleError}
      className="min-w-0 flex-1"
      editorClass="ui:min-h-9 ui:max-h-28 ui:overflow-y-auto ui:py-1 ui:px-1 ui:font-semibold"
    />
    <div class="hidden shrink-0 items-center gap-2 sm:flex">
      {#each COLOR_THEMES as theme (theme)}
        <button
          type="button"
          class={`h-3 w-3 cursor-pointer rounded-full border ${COLOR_CLASSES[theme]} ${theme === colorTheme ? 'ui:ring-offset-muted ring-2 ring-offset-2' : ''}`}
          title={`${labels.color ?? 'Section color'}: ${theme}`}
          onclick={() => onColorThemeChange?.(theme)}
        ></button>
      {/each}
    </div>
    <span class="ui:text-muted-foreground shrink-0 text-sm font-semibold">
      {questionCount}
      {labels.shortQuestions ?? labels.questions ?? 'q'}
    </span>
    <IconButton
      onclick={onDelete}
      tooltip={labels.delete ?? 'Delete section'}
      tooltipSide="bottom"
      variant="outline"
      size="icon-sm"
    >
      <XIcon size={16} />
    </IconButton>
  </div>

  {#if !sectionCollapsed}
    <div class="ui:bg-card border-b px-4 py-3">
      <!-- Imported section passages are HTML, and hand-authored passages need
           the same formatting capabilities. `full` preserves existing tables,
           lists and inline marks instead of narrowing the document schema. -->
      <!-- Grows with its content. A fixed 16rem floor meant six sections of a paper
           that keeps its passages on the questions themselves stacked six empty
           editors, each taller than the questions above it. -->
      <RichTextField
        bind:value={localDescription}
        variant="full"
        oninput={handleDescriptionInput}
        placeholder={labels.descriptionPlaceholder ?? 'Describe this section'}
        errorMessage={descriptionError}
        className="m-0"
        editorClass="ui:min-h-24 ui:h-auto"
      />
    </div>

    <div class="ui:bg-card space-y-4 px-4 py-4">
      {@render children?.()}

      <div class="flex justify-center">
        <Button variant="outline" onclick={onAddQuestion}>+ {labels.addQuestion ?? 'Add question'}</Button>
      </div>
    </div>

    <div class="ui:bg-muted flex items-center justify-between border-t px-4 py-3">
      <p class="ui:text-muted-foreground text-sm">
        {requiredQuestionCount}
        {labels.required ?? 'required'}
      </p>
      <div class="flex items-center gap-1">
        <IconButton
          onclick={onMoveUp}
          disabled={!canMoveUp}
          tooltip={labels.moveUp ?? 'Move section up'}
          tooltipSide="bottom"
        >
          <ArrowUpIcon size={16} />
        </IconButton>
        <IconButton
          onclick={onMoveDown}
          disabled={!canMoveDown}
          tooltip={labels.moveDown ?? 'Move section down'}
          tooltipSide="bottom"
        >
          <ArrowDownIcon size={16} />
        </IconButton>
      </div>
    </div>
  {/if}
</section>
