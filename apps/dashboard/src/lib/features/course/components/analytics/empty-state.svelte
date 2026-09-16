<script lang="ts">
  import type { Component } from 'svelte';
  import ChartBarIcon from '@lucide/svelte/icons/chart-bar';

  interface Props {
    title?: string;
    description?: string;
    icon?: Component;
    className?: string;
  }

  let {
    title = 'No data available',
    description = 'There is no data to display at this time.',
    icon = ChartBarIcon,
    className = ''
  }: Props = $props();

  const SvelteComponent = $derived(icon);
</script>

<div class="flex flex-col items-center justify-center px-4 py-12 {className}">
  <!--
    Tokens rather than a hand-maintained light/dark pair. Each pair below collapsed into one
    class that already knows both themes: `bg-gray-100 dark:bg-neutral-800` is exactly what
    `ui:bg-muted` is for. Seven classes became four, and dark mode stopped being something
    someone has to remember to update.
  -->
  <div class="ui:bg-muted mb-4 flex h-16 w-16 items-center justify-center rounded-full">
    <SvelteComponent size="24" class="ui:text-muted-foreground" />
  </div>
  <h3 class="ui:text-foreground mb-2 text-lg font-medium">
    {title}
  </h3>
  <p class="ui:text-muted-foreground max-w-sm text-center text-sm">
    {description}
  </p>
</div>
