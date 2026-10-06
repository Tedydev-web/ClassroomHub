<script>
  import { BlurFade } from '@cio/ui/custom/animation/blurfade';
  import { MachineEventWire } from '@cio/ui/custom/animation/machines';
  import Webhook from '@lucide/svelte/icons/webhook';
  import Code2 from '@lucide/svelte/icons/code-2';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import { t } from '$lib/i18n';
  import CtaButton from './ui/cta-button.svelte';
  import NotchCard from './ui/notch-card.svelte';
  import Section from './ui/section.svelte';
  import SectionHeader from './ui/section-header.svelte';

  const lanes = $derived([
    { Icon: Code2, ...lane('api') },
    { Icon: Webhook, ...lane('webhooks') },
    { Icon: Sparkles, ...lane('mcp') }
  ]);

  /** @param {string} key */
  function lane(key) {
    return { title: $t(`automation.${key}.title`), description: $t(`automation.${key}.description`) };
  }
</script>

<Section class="bg-gray-50">
  <div class="grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16">
    <SectionHeader
      align="left"
      size="h3"
      eyebrow={$t('automation.eyebrow')}
      eyebrowClass="text-blue-700"
      lede={$t('automation.subhead')}
      ledeClass="text-gray-500"
      titleClass=""
    >
      {#snippet title()}{$t('automation.heading')}{/snippet}
    </SectionHeader>

    <div class="automation-machine h-56 sm:h-64 lg:h-80">
      <MachineEventWire class="h-full" label={$t('automation.machine_label')} />
    </div>
  </div>

  <div class="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
    {#each lanes as lane, i}
      <BlurFade delay={0.05 * i} once class="h-full">
        <NotchCard class="h-full bg-white" notchClass="bg-gray-50">
          <div class="flex size-10 items-center justify-center rounded-md bg-blue-50 text-blue-700">
            <lane.Icon size={20} strokeWidth={1.8} />
          </div>
          <h3 class="text-card-title mt-5 font-medium text-gray-950">{lane.title}</h3>
          <p class="mt-2 text-[15px] leading-relaxed text-gray-500">{lane.description}</p>
        </NotchCard>
      </BlurFade>
    {/each}
  </div>

  <div class="mt-9">
    <CtaButton href="/automation" variant="secondary">{$t('automation.reference')}</CtaButton>
  </div>
</Section>

<style>
  .automation-machine {
    --machine-ink: var(--color-blue-700);
    --machine-face: var(--color-gray-50);
  }
</style>
