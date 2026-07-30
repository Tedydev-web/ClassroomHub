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
  }

  let { sections, navigationLabel }: Props = $props();
</script>

<details class="ui:border-border ui:bg-muted/20 ui:rounded-md ui:border">
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
              <span
                class={`ui:inline-flex ui:h-7 ui:min-w-7 ui:items-center ui:justify-center ui:rounded ui:border ui:px-1.5 ui:text-xs ui:font-medium ${question.isCurrent ? 'ui:border-primary ui:bg-primary ui:text-primary-foreground' : question.isAnswered ? 'ui:border-primary/40 ui:bg-primary/10 ui:text-primary' : 'ui:border-border ui:text-muted-foreground'}`}
              >
                {question.label}
              </span>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </div>
</details>
