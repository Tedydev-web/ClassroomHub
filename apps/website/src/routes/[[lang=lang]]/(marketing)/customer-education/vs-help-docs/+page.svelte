<script lang="ts">
  import { t } from '$lib/i18n';
  import { HeroSubtitle, PageHeader, PageSignupCTA, VsHelpDocs } from '$lib/components';
  import { Badge } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import { BlurFade } from '@cio/ui/custom/animation/blurfade';
  import FileText from '@lucide/svelte/icons/file-text';
  import GraduationCap from '@lucide/svelte/icons/graduation-cap';

  const competitors = [
    {
      name: $t('vs_help_docs.competitors.0.name'),
      good: $t('vs_help_docs.competitors.0.good'),
      missing: $t('vs_help_docs.competitors.0.missing')
    },
    {
      name: $t('vs_help_docs.competitors.1.name'),
      good: $t('vs_help_docs.competitors.1.good'),
      missing: $t('vs_help_docs.competitors.1.missing')
    },
    {
      name: $t('vs_help_docs.competitors.2.name'),
      good: $t('vs_help_docs.competitors.2.good'),
      missing: $t('vs_help_docs.competitors.2.missing')
    }
  ];

  const verdicts = [
    {
      Icon: FileText,
      title: $t('vs_help_docs.verdicts.0.title'),
      body: $t('vs_help_docs.verdicts.0.body')
    },
    {
      Icon: GraduationCap,
      title: $t('vs_help_docs.verdicts.1.title'),
      body: $t('vs_help_docs.verdicts.1.body')
    }
  ];
</script>

<section class="bg-white">
  <PageHeader className="px-6 lg:px-12">
    <div class="mx-auto max-w-[1100px]">
      <Badge variant="outline" class="mb-6 gap-2! bg-white px-3.5! py-1.5!"
        >{$t('vs_help_docs.customer_academy_vs_help_docs')}</Badge
      >

      <h1 class="max-w-[820px] text-[clamp(2rem,3.4vw,2.8rem)] leading-[1.1] font-medium tracking-tight text-gray-950">
        {$t('vs_help_docs.why_your_help_center')}
        <em class="text-blue-700 not-italic">isn't teaching</em>
        your customers.
      </h1>

      <HeroSubtitle>
        {$t('vs_help_docs.intercom_articles_zendesk_guide_and_confluence')}
      </HeroSubtitle>

      <div class="mt-8 flex flex-wrap items-center gap-3">
        <Button href="/signup">{$t('vs_help_docs.launch_your_academy_free')}</Button>
        <Button href="/customer-education" variant="outline">{$t('vs_help_docs.see_a_live_academy')}</Button>
      </div>
    </div>
  </PageHeader>

  <!-- Quick verdict cards -->
  <section class="px-6 py-12 lg:px-12 lg:py-16">
    <div class="mx-auto max-w-[1100px]">
      <div class="mb-8 max-w-[640px]">
        <div class="mb-2 text-xs font-medium tracking-widest text-blue-700 uppercase">
          {$t('vs_help_docs.the_short_answer')}
        </div>
        <h2 class="text-[clamp(1.75rem,2.6vw,2.2rem)] leading-[1.15] font-medium tracking-tight">
          {$t('vs_help_docs.you_need_both_they_do_different')}
        </h2>
      </div>

      <div class="grid grid-cols-1 gap-5 md:grid-cols-2">
        {#each verdicts as v, i}
          <BlurFade delay={0.1 * i} once>
            <div class="h-full rounded-2xl border border-gray-200 bg-gray-50 p-7">
              <div
                class="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-white text-blue-700 ring-1 ring-gray-200"
              >
                <v.Icon size={20} strokeWidth={1.75} />
              </div>
              <h3 class="text-base font-medium text-gray-950">{v.title}</h3>
              <p class="mt-3 text-sm leading-relaxed text-gray-600">{v.body}</p>
            </div>
          </BlurFade>
        {/each}
      </div>
    </div>
  </section>

  <!-- The detailed comparison -->
  <VsHelpDocs bgClass="bg-gray-50" showHeading={true} />

  <!-- Compared head-to-head -->
  <section class="px-6 py-12 lg:px-12 lg:py-16">
    <div class="mx-auto max-w-[1100px]">
      <div class="mb-8 max-w-[640px]">
        <div class="mb-2 text-xs font-medium tracking-widest text-blue-700 uppercase">
          {$t('vs_help_docs.tool_by_tool')}
        </div>
        <h2 class="text-[clamp(1.75rem,2.6vw,2.2rem)] leading-[1.15] font-medium tracking-tight">
          {$t('vs_help_docs.what_the_popular_help_doc_tools')}
        </h2>
      </div>

      <div class="grid grid-cols-1 gap-5 md:grid-cols-3">
        {#each competitors as competitor, i}
          <BlurFade delay={0.08 * i} once>
            <div class="flex h-full flex-col rounded-2xl border border-gray-200 bg-white p-6">
              <p class="text-base font-medium text-gray-950">{competitor.name}</p>
              <div class="mt-5">
                <p class="text-[10px] tracking-wider text-emerald-600 uppercase">{$t('vs_help_docs.where_it_wins')}</p>
                <p class="mt-1.5 text-sm leading-relaxed text-gray-600">{competitor.good}</p>
              </div>
              <div class="mt-5">
                <p class="text-[10px] tracking-wider text-rose-600 uppercase">{$t('vs_help_docs.where_it_doesn_t')}</p>
                <p class="mt-1.5 text-sm leading-relaxed text-gray-600">{competitor.missing}</p>
              </div>
            </div>
          </BlurFade>
        {/each}
      </div>
    </div>
  </section>

  <PageSignupCTA
    header={$t('vs_help_docs.stop_forwarding_help_articles_to_every')}
    subText={$t('vs_help_docs.bundle_the_articles_into_a_real')}
    btnLabel={$t('vs_help_docs.book_a_demo')}
  />
</section>
