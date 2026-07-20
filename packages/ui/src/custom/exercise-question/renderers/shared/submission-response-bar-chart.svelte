<script lang="ts">
  import { onMount } from 'svelte';
  import type { ChartConfig } from '../../../../base/chart';

  // layerchart has an internal circular ESM graph that Vite's dev SSR module
  // runner cannot evaluate ("dependency module is not yet fully initialized"),
  // so importing the chart module statically breaks every page that transitively
  // pulls it through the @cio/ui barrel. Charts need the DOM anyway, so load the
  // chart module on the client only.
  let Chart = $state<typeof import('../../../../base/chart') | null>(null);
  onMount(async () => {
    Chart = await import('../../../../base/chart');
  });

  interface Row {
    key: string;
    label: string;
    responses: number;
    color?: string;
  }

  interface Props {
    chartData: Row[];
    chartConfig: ChartConfig;
    emptyLabel: string;
    series: Array<{ key: string; value: string; label: string; color: string }>;
  }

  let { chartData, chartConfig, emptyLabel, series }: Props = $props();

  const ROW_HEIGHT_PX = 48;
  const MIN_CHART_HEIGHT_PX = 120;
  const AXIS_LABEL_MAX_LENGTH = 28;

  const chartHeightPx = $derived(Math.max(MIN_CHART_HEIGHT_PX, chartData.length * ROW_HEIGHT_PX));

  function truncateAxisLabel(label: string): string {
    if (label.length <= AXIS_LABEL_MAX_LENGTH) return label;

    return `${label.slice(0, AXIS_LABEL_MAX_LENGTH - 1).trimEnd()}…`;
  }
</script>

{#if chartData.length > 0}
  {#if Chart}
    <Chart.Container config={chartConfig} class="ui:aspect-auto ui:w-full" style="height: {chartHeightPx}px">
      <Chart.BarChart
        data={chartData}
        orientation="horizontal"
        y="label"
        axis="y"
        bandPadding={0.25}
        props={{ yAxis: { format: truncateAxisLabel } }}
        {series}
      />
    </Chart.Container>
  {/if}
{:else}
  <p class="ui:text-muted-foreground ui:text-sm">{emptyLabel}</p>
{/if}
