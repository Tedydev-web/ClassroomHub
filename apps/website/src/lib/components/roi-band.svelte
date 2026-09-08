<script>
  import { t } from '$lib/i18n';
  import BoxedGrid from './boxed-grid.svelte';

  /**
   * @typedef {Object} Props
   * @property {string} [bgClass]
   * @property {string} [eyebrow]
   * @property {string} [heading]
   * @property {string} [subhead]
   */

  /** @type {Props} */
  let { bgClass = 'bg-white', eyebrow = undefined, heading = undefined, subhead = undefined } = $props();

  /**
   * Product facts, not borrowed benchmarks. The band used to republish
   * Forrester/Intellum/TSIA percentages this deployment has no data behind and
   * no licence to quote, which is a claim we cannot stand behind if asked.
   */
  const stats = $derived(
    ['domain', 'records', 'one_platform'].map((key) => ({
      value: $t(`roi.${key}.value`),
      label: $t(`roi.${key}.label`),
      source: $t(`roi.${key}.source`)
    }))
  );
</script>

<section class="{bgClass} px-6 py-12 lg:px-12 lg:py-16">
  <div class="mx-auto max-w-[1100px]">
    <div class="mb-8 max-w-[640px]">
      <div class="mb-2 text-xs font-medium tracking-widest text-blue-700 uppercase">{eyebrow ?? $t('roi.eyebrow')}</div>
      <h2 class="text-[clamp(1.75rem,2.6vw,2.2rem)] leading-[1.15] font-medium tracking-tight">
        {heading ?? $t('roi.heading')}
      </h2>
      <p class="mt-3 text-sm leading-relaxed text-gray-500">{subhead ?? $t('roi.subhead')}</p>
    </div>

    <BoxedGrid items={stats} cols={3} padding="px-5 py-10 lg:py-12">
      {#snippet cell(stat)}
        <div class="flex h-full flex-col items-center justify-center text-center">
          <p class="text-[clamp(1.5rem,2.4vw,2rem)] font-medium tracking-tight text-gray-950">{stat.value}</p>
          <p class="mt-1.5 text-sm text-gray-600">{stat.label}</p>
          <p class="mt-3 text-[11px] text-gray-400">{stat.source}</p>
        </div>
      {/snippet}
    </BoxedGrid>
  </div>
</section>
