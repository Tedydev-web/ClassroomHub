<script>
  import { BlurFade } from '@cio/ui/custom/animation/blurfade';
  import { t } from '$lib/i18n';
  import LayoutTemplate from '@lucide/svelte/icons/layout-template';
  import MessagesSquare from '@lucide/svelte/icons/messages-square';
  import Terminal from '@lucide/svelte/icons/terminal';
  import Eyebrow from './ui/eyebrow.svelte';
  import Section from './ui/section.svelte';
  import SectionHeader from './ui/section-header.svelte';

  const lanes = $derived([
    { Icon: LayoutTemplate, ...lane('template') },
    { Icon: MessagesSquare, ...lane('chat') },
    { Icon: Terminal, ...lane('agent') }
  ]);

  /** @param {string} key */
  function lane(key) {
    return { title: $t(`ai_builds.${key}.title`), description: $t(`ai_builds.${key}.description`) };
  }

  const agents = [
    { name: 'Cursor', logo: '/assets/assets/www/home/cursor-logo.png' },
    { name: 'Claude Code', logo: '/assets/assets/www/home/claude-logo.svg' },
    { name: 'Codex', logo: '/assets/assets/www/home/codex-logo.png' },
    { name: 'OpenCode', logo: '/assets/assets/www/home/opencode-logo.svg' }
  ];
</script>

<Section class="bg-gray-50">
  <BlurFade once>
    <SectionHeader
      eyebrow="AI authoring"
      eyebrowClass="text-blue-700"
      lede={$t('ai_builds.subhead')}
      ledeClass="text-gray-500"
    >
      {#snippet title()}
        {$t('ai_builds.heading_lead')} <em class="text-blue-700 not-italic">{$t('ai_builds.heading_accent')}</em>
      {/snippet}
    </SectionHeader>
  </BlurFade>

  <BlurFade delay={0.1} once>
    <div class="mt-12 w-full overflow-hidden rounded-xl bg-white ring-1 ring-gray-200">
      <img
        src="/assets/assets/www/home/ai-course-builder.jpeg"
        alt={$t('ai_builds.image_alt')}
        class="block h-auto w-full"
        loading="lazy"
        decoding="async"
      />
    </div>
  </BlurFade>

  <div class="mt-12 grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-6">
    {#each lanes as lane, i}
      <BlurFade delay={0.05 * i + 0.15} once>
        <div>
          <div class="flex size-10 items-center justify-center rounded-md bg-gray-100 text-gray-950">
            <lane.Icon size={20} strokeWidth={1.8} />
          </div>
          <h3 class="text-card-title mt-5 font-medium text-gray-950">{lane.title}</h3>
          <p class="mt-2 max-w-[320px] text-[15px] leading-relaxed text-gray-500">{lane.description}</p>
        </div>
      </BlurFade>
    {/each}
  </div>

  <BlurFade delay={0.3} once>
    <div class="mt-12 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-gray-200 pt-6">
      <Eyebrow size="sm" class="text-gray-500">{$t('ai_builds.works_with')}</Eyebrow>
      {#each agents as agent}
        <div class="flex items-center gap-1.5">
          <img src={agent.logo} alt="{agent.name} logo" class="h-4 w-4 rounded-full" />
          <span class="text-sm text-gray-600">{agent.name}</span>
        </div>
      {/each}
    </div>
  </BlurFade>
</Section>
