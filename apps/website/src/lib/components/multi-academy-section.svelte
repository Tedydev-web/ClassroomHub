<script>
  import { t } from '$lib/i18n';
  import { BlurFade } from '@cio/ui/custom/animation/blurfade';
  import { MachineBrandStand } from '@cio/ui/custom/animation/machines';
  import BoxedGrid from './boxed-grid.svelte';
  import Palette from '@lucide/svelte/icons/palette';
  import Globe from '@lucide/svelte/icons/globe';
  import Receipt from '@lucide/svelte/icons/receipt';
  import Eyebrow from './ui/eyebrow.svelte';
  import MachineCard from './ui/machine-card.svelte';
  import Section from './ui/section.svelte';

  const academies = $derived([
    {
      index: '01',
      name: $t('multi_academy.customer'),
      domain: 'learn.acme.com',
      audience: 'Customers · onboarding · adoption',
      barWidth: '72%',
      dot: 'bg-blue-500',
      bar: 'bg-blue-500',
      badge: 'bg-blue-50 text-blue-700'
    },
    {
      index: '02',
      name: $t('multi_academy.partner'),
      domain: 'partners.acme.com',
      audience: 'Resellers · agencies · integrators',
      barWidth: '54%',
      dot: 'bg-violet-500',
      bar: 'bg-violet-500',
      badge: 'bg-violet-50 text-violet-700'
    },
    {
      index: '03',
      name: $t('multi_academy.internal'),
      domain: 'team.acme.com',
      audience: 'Employees · onboarding · compliance',
      barWidth: '88%',
      dot: 'bg-emerald-500',
      bar: 'bg-emerald-500',
      badge: 'bg-emerald-50 text-emerald-700'
    }
  ]);

  const benefits = $derived([
    {
      Icon: Palette,
      title: $t('multi_academy.brand.title'),
      description: $t('multi_academy.brand.description')
    },
    {
      Icon: Globe,
      title: $t('multi_academy.domain.title'),
      description: $t('multi_academy.domain.description')
    },
    {
      Icon: Receipt,
      title: $t('multi_academy.invoice.title'),
      description: $t('multi_academy.invoice.description')
    }
  ]);
</script>

<Section class="bg-white">
  <div class="grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16">
    <div>
      <BlurFade once>
        <Eyebrow class="text-blue-700">{$t('multi_academy.eyebrow')}</Eyebrow>
      </BlurFade>

      <BlurFade delay={0.05} once>
        <h2 class="text-h3 mt-4 text-balance text-gray-950">
          {$t('multi_academy.heading_lead')}
          <em class="text-gray-700 not-italic">{$t('multi_academy.heading_accent')}</em>
        </h2>
      </BlurFade>

      <BlurFade delay={0.1} once>
        <p class="text-lead mt-[18px] max-w-[480px] text-pretty text-gray-500">
          {$t('multi_academy.subhead')}
        </p>
      </BlurFade>
    </div>

    <BlurFade delay={0.1} once>
      <MachineCard>
        <MachineBrandStand
          class="h-56 sm:h-64 lg:h-72"
          label="Three academy brands, Acme, Northwind and Kestrel, rotating on one stand under learn.acme.com"
        />
      </MachineCard>
    </BlurFade>
  </div>

  <div class="mt-12 border-t border-gray-200">
    {#each academies as a, i}
      <BlurFade delay={0.05 * i + 0.15} once>
        <div
          class="grid grid-cols-[auto_1fr] gap-x-4 border-b border-gray-200 py-5 lg:grid-cols-[40px_1.6fr_1.6fr_1fr_auto] lg:items-center lg:gap-x-6"
        >
          <p class="font-mono text-xs text-gray-400">{a.index}</p>

          <div class="flex items-start gap-3">
            <span class="mt-2 h-2 w-2 shrink-0 rounded-full {a.dot}"></span>
            <div>
              <p class="text-base font-medium text-gray-950">{a.name}</p>
              <p class="font-mono text-[11px] text-gray-500 lg:text-xs">{a.domain}</p>
            </div>
          </div>

          <p class="col-span-2 mt-2 text-sm text-gray-600 lg:col-span-1 lg:mt-0">{a.audience}</p>

          <div class="col-span-2 mt-2 h-1 w-full overflow-hidden rounded-full bg-gray-100 lg:col-span-1 lg:mt-0">
            <div class="h-full rounded-full {a.bar}" style="width: {a.barWidth}"></div>
          </div>

          <span
            class="col-span-2 mt-2 inline-block w-fit rounded-full px-2.5 py-1 text-xs font-medium {a.badge} lg:col-span-1 lg:mt-0"
          >
            Active
          </span>
        </div>
      </BlurFade>
    {/each}
  </div>

  <div class="mt-12">
    <BoxedGrid items={benefits} cols={3} padding="p-5 lg:p-6">
      {#snippet cell(benefit)}
        <div class="flex size-10 items-center justify-center rounded-md bg-gray-100 text-gray-950">
          <benefit.Icon size={20} strokeWidth={1.8} />
        </div>
        <h3 class="text-card-title mt-5 font-medium text-gray-950">{benefit.title}</h3>
        <p class="mt-2 text-[15px] leading-relaxed text-gray-500">{benefit.description}</p>
      {/snippet}
    </BoxedGrid>
  </div>
</Section>
