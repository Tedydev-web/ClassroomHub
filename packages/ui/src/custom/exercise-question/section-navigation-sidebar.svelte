<script lang="ts">
  import { richTextToPlainText } from '../../tools';

  interface SectionNavQuestion {
    key: string;
    label: string;
    isAnswered: boolean;
    isCurrent: boolean;
  }

  interface SectionNavGroup {
    id: string;
    title: string;
    questions: SectionNavQuestion[];
    isCurrent: boolean;
  }

  interface Props {
    sections: SectionNavGroup[];
    navigationLabel: string;
    /**
     * Given, every number becomes a button that jumps to the group holding it, and the
     * panel starts open.
     *
     * Without it the numbers are what they have always been: a picture of where you are.
     * That was the whole panel for the exam paper — a candidate on question 38 who wanted
     * to check question 4 had to press Previous thirty-four times, past a grid showing them
     * exactly where 4 was and refusing to go there.
     */
    onSelect?: (groupId: string) => void;
    /** Where a section jumps to, when a section's questions do not all share one target. */
    selectLabel?: (label: string) => string;
  }

  let { sections, navigationLabel, onSelect, selectLabel }: Props = $props();

  const interactive = $derived(typeof onSelect === 'function');

  const CHIP =
    'ui:inline-flex ui:h-7 ui:min-w-7 ui:items-center ui:justify-center ui:rounded ui:border ui:px-1.5 ui:text-xs ui:font-medium';

  function chipClass(question: SectionNavQuestion): string {
    if (question.isCurrent) return `${CHIP} ui:border-primary ui:bg-primary ui:text-primary-foreground`;
    if (question.isAnswered) return `${CHIP} ui:border-primary/40 ui:bg-primary/10 ui:text-primary`;

    return `${CHIP} ui:border-border ui:text-muted-foreground`;
  }
</script>

<details class="ui:border-border ui:bg-muted/20 ui:rounded-md ui:border" open={interactive}>
  <summary
    class="ui:focus-visible:ring-ring ui:flex ui:min-h-11 ui:cursor-pointer ui:items-center ui:px-4 ui:text-sm ui:font-semibold ui:outline-none ui:focus-visible:ring-2 ui:focus-visible:ring-offset-2"
  >
    {navigationLabel}
  </summary>
  <div class="ui:border-border ui:border-t ui:p-3">
    <div class="ui:flex ui:flex-col ui:gap-3">
      {#each sections as section (section.id)}
        <div class="ui:space-y-2">
          <p
            class={`ui:text-xs ui:font-semibold ${section.isCurrent ? 'ui:text-primary' : 'ui:text-muted-foreground'}`}
          >
            {richTextToPlainText(section.title)}
          </p>
          <div class="ui:flex ui:flex-wrap ui:gap-1.5">
            {#each section.questions as question (question.key)}
              {#if interactive}
                <button
                  type="button"
                  class={`${chipClass(question)} ui:focus-visible:ring-ring ui:cursor-pointer ui:transition-colors ui:outline-none ui:focus-visible:ring-2 ui:focus-visible:ring-offset-1 ui:hover:border-primary`}
                  aria-current={question.isCurrent ? 'step' : undefined}
                  aria-label={selectLabel ? selectLabel(question.label) : question.label}
                  onclick={() => onSelect?.(section.id)}
                >
                  {question.label}
                </button>
              {:else}
                <span class={chipClass(question)}>{question.label}</span>
              {/if}
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </div>
</details>
