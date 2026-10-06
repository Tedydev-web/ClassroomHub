<script>
  import { t } from '$lib/i18n';
  import BoxedGrid from './boxed-grid.svelte';
  import Section from './ui/section.svelte';
  import SectionHeader from './ui/section-header.svelte';

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

<Section class={bgClass}>
  <SectionHeader
    eyebrow={eyebrow ?? $t('roi.eyebrow')}
    eyebrowClass="text-blue-700"
    lede={subhead ?? $t('roi.subhead')}
    ledeClass="text-gray-500"
    titleClass=""
  >
    {#snippet title()}{heading ?? $t('roi.heading')}{/snippet}
  </SectionHeader>

  <div class="mt-12">
    <BoxedGrid items={stats} cols={3} padding="px-6 py-10 lg:py-12">
      {#snippet cell(stat)}
        <div class="flex h-full flex-col items-center justify-center text-center">
          <p class="text-h4 font-medium text-gray-950">{stat.value}</p>
          <p class="mt-2 text-[15px] text-gray-600">{stat.label}</p>
          <p class="mt-3 text-xs text-gray-400">{stat.source}</p>
        </div>
      {/snippet}
    </BoxedGrid>
  </div>
</Section>
