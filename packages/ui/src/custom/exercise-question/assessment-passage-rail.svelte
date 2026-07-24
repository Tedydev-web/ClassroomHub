<script lang="ts">
  import * as Tooltip from '../../base/tooltip';

  interface PassageRailItem {
    id: string;
    passageLabel: string;
    questionRangeLabel: string;
    progressLabel: string;
  }

  interface Props {
    items: PassageRailItem[];
    activeQuestionGroupId: string | null;
    visiblePassageGroupId: string | null;
    navigationLabel: string;
    onSelect: (groupId: string) => void;
  }

  let { items, activeQuestionGroupId, visiblePassageGroupId, navigationLabel, onSelect }: Props = $props();
</script>

<nav
  class="ui:border-border ui:bg-muted/20 ui:hidden ui:w-11 ui:shrink-0 ui:border-x ui:lg:flex ui:lg:flex-col ui:lg:items-center ui:lg:justify-center"
  aria-label={navigationLabel}
>
  <Tooltip.Provider delayDuration={150}>
    <div class="ui:flex ui:max-h-full ui:flex-col ui:items-center ui:gap-1 ui:overflow-y-auto ui:py-3">
      {#each items as item (item.id)}
        {@const isActive = activeQuestionGroupId === item.id}
        {@const isPassageVisible = visiblePassageGroupId === item.id}
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <button
                {...props}
                type="button"
                class="ui:group ui:focus-visible:ring-ring ui:flex ui:size-11 ui:shrink-0 ui:cursor-pointer ui:items-center ui:justify-center ui:rounded-md ui:outline-none ui:transition-transform ui:duration-150 ui:active:translate-y-0.5 ui:focus-visible:ring-2 ui:focus-visible:ring-offset-2"
                aria-label={`${item.passageLabel}. ${item.questionRangeLabel}. ${item.progressLabel}`}
                aria-current={isActive ? 'step' : undefined}
                onclick={() => onSelect(item.id)}
              >
                <span
                  class={[
                    'ui:block ui:h-1 ui:rounded-full ui:transition-[width,color,box-shadow] ui:duration-200',
                    isActive ? 'ui:bg-primary ui:w-7' : 'ui:bg-muted-foreground/55 ui:w-5 ui:group-hover:w-6',
                    isPassageVisible && !isActive ? 'ui:ring-primary/35 ui:ring-2 ui:ring-offset-2' : ''
                  ]}
                  aria-hidden="true"
                ></span>
              </button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content side="left" sideOffset={8} class="ui:w-64 ui:space-y-1 ui:px-4 ui:py-3">
            <p class="ui:text-sm ui:font-semibold">{item.passageLabel}</p>
            <p class="ui:text-primary-foreground/80">{item.questionRangeLabel}</p>
            <p class="ui:text-primary-foreground/80">{item.progressLabel}</p>
          </Tooltip.Content>
        </Tooltip.Root>
      {/each}
    </div>
  </Tooltip.Provider>
</nav>
