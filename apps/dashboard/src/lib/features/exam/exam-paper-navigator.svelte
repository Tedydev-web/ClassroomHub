<script lang="ts">
  import BookmarkIcon from '@lucide/svelte/icons/bookmark';
  import StickyNoteIcon from '@lucide/svelte/icons/sticky-note';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import { Button } from '@cio/ui/base/button';
  import * as Sheet from '@cio/ui/base/sheet';
  import { richTextToPlainText } from '@cio/ui/tools';

  import { t } from '$lib/utils/functions/translations';
  import type { OutlineGroup } from './paper-outline';
  import type { PaperNote } from './exam-annotations';

  /**
   * The way around the paper, in a drawer rather than in the page.
   *
   * It used to be a panel above the questions, which cost the top of every screen to a grid
   * the candidate reads twice in an hour. In a drawer it costs one button, and the button
   * can say the thing the panel was really for — how much is left to answer.
   *
   * Three things live here and they are ordered by how often they are wanted: the numbers,
   * then what was bookmarked, then what was written down. The numbers are never pushed
   * below the fold by the other two; where there is nothing bookmarked or noted, those
   * sections are absent rather than empty.
   */
  let {
    groups,
    notes,
    answered,
    total,
    open = false,
    onOpenChange,
    onSelect,
    onRemoveNote
  }: {
    groups: OutlineGroup[];
    notes: PaperNote[];
    answered: number;
    total: number;
    open?: boolean;
    onOpenChange: (open: boolean) => void;
    /** Given the number on the paper, not the group holding it. */
    onSelect: (questionNumber: number) => void;
    onRemoveNote: (id: string) => void;
  } = $props();

  const bookmarked = $derived(groups.flatMap((group) => group.questions.filter((question) => question.isBookmarked)));

  const CHIP =
    'ui:inline-flex ui:h-11 ui:min-w-11 ui:items-center ui:justify-center ui:rounded-md ui:border ui:px-2 ui:text-sm ui:font-medium ui:relative ui:transition-[background-color,border-color,transform] ui:duration-150 ui:outline-none ui:focus-visible:ring-2 ui:focus-visible:ring-ring ui:focus-visible:ring-offset-1 ui:active:scale-[0.97]';

  function chipClass(question: { isCurrent: boolean; isAnswered: boolean }): string {
    if (question.isCurrent)
      return `${CHIP} ui:border-primary ui:bg-primary ui:text-primary-foreground ui:font-semibold`;
    if (question.isAnswered) return `${CHIP} ui:border-primary ui:bg-primary/15 ui:text-primary ui:font-semibold`;

    return `${CHIP} ui:border-border ui:text-muted-foreground ui:hover:border-primary`;
  }

  function go(label: string) {
    const number = Number(label);
    if (Number.isInteger(number)) onSelect(number);

    onOpenChange(false);
  }
</script>

{#snippet chip(question: {
  key: string;
  label: string;
  isCurrent: boolean;
  isAnswered: boolean;
  isBookmarked: boolean;
  hasNote: boolean;
})}
  <button type="button" class={chipClass(question)} onclick={() => go(question.label)}>
    {question.label}

    <!--
      Each mark carries its own ground rather than inheriting the chip's.
      Drawn in the chip's own text colour, a bookmark came out near-black on an unanswered
      chip and vanished into the fill on the current one — the two chips a candidate most
      needs to tell apart. A badge on `bg-background` looks the same on all three states,
      which is the only way one glance can be trusted.
    -->
    {#if question.isBookmarked}
      <span
        class="ui:bg-background ui:absolute ui:flex ui:size-4 ui:items-center ui:justify-center ui:rounded-full -top-1.5 -right-1.5"
        aria-label={$t('exam.navigator.bookmarked')}
      >
        <BookmarkIcon size={11} class="ui:fill-amber-400 ui:text-amber-500" />
      </span>
    {/if}

    <!--
      A dot, not the note icon: at this size a sticky-note glyph is a smudge, while a dot of
      a different colour in a different corner is unmistakable. The drawer below spells out
      in words and full-size icons what the two marks mean.
    -->
    {#if question.hasNote}
      <span
        class="ui:bg-background ui:absolute ui:flex ui:size-3 ui:items-center ui:justify-center ui:rounded-full -right-1 -bottom-1"
        aria-label={$t('exam.navigator.has_note')}
      >
        <span class="ui:bg-emerald-500 ui:size-2 ui:rounded-full"></span>
      </span>
    {/if}
  </button>
{/snippet}

<Sheet.Root {open} onOpenChange={(next) => onOpenChange(next)}>
  <Sheet.Content side="right" class="ui:w-full ui:gap-0 ui:overflow-y-auto ui:sm:max-w-sm">
    <Sheet.Header>
      <Sheet.Title>{$t('exam.navigator.title')}</Sheet.Title>
      <Sheet.Description>
        {$t('exam.navigator.answered_of', { answered: String(answered), total: String(total) })}
      </Sheet.Description>
    </Sheet.Header>

    <div class="ui:space-y-6 ui:px-4 ui:pb-8">
      <!-- Said once, in words, so the colours do not have to be learned. -->
      <p class="ui:text-muted-foreground ui:text-xs">{$t('exam.navigator.legend')}</p>

      <div class="ui:space-y-4">
        {#each groups as group (group.id)}
          <div class="ui:space-y-2">
            <p
              class={`ui:text-xs ui:font-semibold ${group.isCurrent ? 'ui:text-primary' : 'ui:text-muted-foreground'}`}
            >
              {richTextToPlainText(group.title)}
            </p>
            <div class="ui:flex ui:flex-wrap ui:gap-2">
              {#each group.questions as question (question.key)}
                {@render chip(question)}
              {/each}
            </div>
          </div>
        {/each}
      </div>

      {#if bookmarked.length > 0}
        <div class="ui:space-y-2">
          <p class="ui:flex ui:items-center ui:gap-1.5 ui:text-xs ui:font-semibold">
            <BookmarkIcon size={14} class="ui:fill-amber-400 ui:text-amber-500" aria-hidden="true" />
            {$t('exam.navigator.bookmarks')}
          </p>
          <div class="ui:flex ui:flex-wrap ui:gap-2">
            {#each bookmarked as question (question.key)}
              {@render chip(question)}
            {/each}
          </div>
        </div>
      {/if}

      {#if notes.length > 0}
        <div class="ui:space-y-2">
          <p class="ui:flex ui:items-center ui:gap-1.5 ui:text-xs ui:font-semibold">
            <StickyNoteIcon size={14} class="ui:text-emerald-600" aria-hidden="true" />
            {$t('exam.navigator.notes')}
          </p>
          <ul class="ui:space-y-2">
            {#each notes as note (note.id)}
              <li class="ui:border-border ui:rounded-md ui:border ui:p-2">
                <div class="ui:flex ui:items-start ui:gap-2">
                  <button
                    type="button"
                    class="ui:min-w-0 ui:flex-1 ui:text-left"
                    onclick={() => go(String(note.questionNumber))}
                  >
                    <span class="ui:text-primary ui:text-xs ui:font-semibold">
                      {$t('exam.navigator.note_on', { number: String(note.questionNumber) })}
                    </span>
                    {#if note.quote}
                      <span class="ui:text-muted-foreground ui:mt-0.5 ui:block ui:text-xs ui:italic">
                        “{note.quote}”
                      </span>
                    {/if}
                    <span class="ui:mt-1 ui:block ui:text-sm">{note.body}</span>
                  </button>

                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={$t('exam.navigator.remove_note')}
                    onclick={() => onRemoveNote(note.id)}
                  >
                    <Trash2Icon size={14} />
                  </Button>
                </div>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  </Sheet.Content>
</Sheet.Root>
