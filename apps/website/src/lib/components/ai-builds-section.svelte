<script>
  import { BlurFade } from '@cio/ui/custom/animation/blurfade';
  import { t } from '$lib/i18n';
  import LayoutTemplate from '@lucide/svelte/icons/layout-template';
  import MessagesSquare from '@lucide/svelte/icons/messages-square';
  import Terminal from '@lucide/svelte/icons/terminal';

  const lanes = $derived([
    { Icon: LayoutTemplate, ...lane('template') },
    { Icon: MessagesSquare, ...lane('chat') },
    { Icon: Terminal, ...lane('agent') }
  ]);

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

<section class="bg-gray-50 px-6 py-12 lg:px-12 lg:py-16">
  <div class="mx-auto max-w-[1100px]">
    <BlurFade once>
      <div class="mb-2 text-xs font-medium tracking-widest text-blue-700 uppercase">AI authoring</div>
      <h2 class="max-w-[760px] text-[clamp(1.75rem,3vw,2.6rem)] leading-[1.1] font-medium tracking-tight text-gray-950">
        {$t('ai_builds.heading_lead')} <em class="text-blue-700 not-italic">{$t('ai_builds.heading_accent')}</em>
      </h2>
      <p class="mt-3 max-w-[560px] text-sm leading-relaxed text-gray-500">
        {$t('ai_builds.subhead')}
      </p>
    </BlurFade>

    <BlurFade delay={0.1} once>
      <div class="mx-auto mt-10 w-full max-w-[1100px]">
        <div class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-200">
          <img
            src="/assets/assets/www/home/ai-course-builder.jpeg"
            alt={$t('ai_builds.image_alt')}
            class="block h-auto w-full"
            loading="lazy"
            decoding="async"
          />
        </div>
      </div>
    </BlurFade>

    <div class="mt-10 grid grid-cols-1 gap-8 md:grid-cols-3">
      {#each lanes as lane, i}
        <BlurFade delay={0.05 * i + 0.15} once>
          <div>
            <div class="text-gray-950">
              <lane.Icon size={20} strokeWidth={1.6} />
            </div>
            <h3 class="mt-3 text-sm font-medium text-gray-950 lg:text-base">{lane.title}</h3>
            <p class="mt-1.5 max-w-[280px] text-xs leading-relaxed text-gray-500 lg:text-sm">{lane.description}</p>
          </div>
        </BlurFade>
      {/each}
    </div>

    <BlurFade delay={0.3} once>
      <div class="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-gray-200 pt-6">
        <span class="text-[10px] font-medium tracking-widest text-gray-500 uppercase">{$t('ai_builds.works_with')}</span
        >
        {#each agents as agent}
          <div class="flex items-center gap-1.5">
            <img src={agent.logo} alt="{agent.name} logo" class="h-4 w-4 rounded-full" />
            <span class="text-xs text-gray-600">{agent.name}</span>
          </div>
        {/each}
      </div>
    </BlurFade>
  </div>
</section>
