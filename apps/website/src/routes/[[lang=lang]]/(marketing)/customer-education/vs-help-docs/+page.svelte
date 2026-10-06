<script lang="ts">
  import { t } from '$lib/i18n';
  import { HeroSubtitle, PageHeader, PageSignupCTA, VsHelpDocs } from '$lib/components';
  import { Badge } from '@cio/ui/base/badge';
  import { CtaButton, NotchCard, Section, SectionHeader } from '$lib/components/ui';
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
  <PageHeader className="px-6 md:px-10">
    <div class="max-w-content mx-auto">
      <Badge variant="outline" class="mb-6 gap-2! bg-white px-3.5! py-1.5!"
        >{$t('vs_help_docs.customer_academy_vs_help_docs')}</Badge
      >

      <h1 class="text-display max-w-[1000px] text-balance text-gray-950">
        {$t('vs_help_docs.why_your_help_center')}
        <em class="text-blue-700 not-italic">isn't teaching</em>
        your customers.
      </h1>

      <HeroSubtitle>
        {$t('vs_help_docs.intercom_articles_zendesk_guide_and_confluence')}
      </HeroSubtitle>

      <div class="mt-9 flex flex-wrap items-center gap-3">
        <CtaButton href="/signup">{$t('vs_help_docs.launch_your_academy_free')}</CtaButton>
        <CtaButton href="/customer-education" variant="secondary">{$t('vs_help_docs.see_a_live_academy')}</CtaButton>
      </div>
    </div>
  </PageHeader>

  <Section>
    <SectionHeader
      eyebrow={$t('vs_help_docs.the_short_answer')}
      eyebrowClass="text-blue-700"
      titleClass=""
      class="mb-12 md:mb-16"
    >
      {#snippet title()}{$t('vs_help_docs.you_need_both_they_do_different')}{/snippet}
    </SectionHeader>

    <div class="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
      {#each verdicts as v, i}
        <BlurFade delay={0.1 * i} once class="h-full">
          <NotchCard class="h-full bg-gray-50">
            <div
              class="mb-5 flex size-10 items-center justify-center rounded-md bg-white text-blue-700 ring-1 ring-gray-200"
            >
              <v.Icon size={20} strokeWidth={1.8} />
            </div>
            <h3 class="text-card-title font-medium text-gray-950">{v.title}</h3>
            <p class="mt-3 text-[15px] leading-relaxed text-gray-600">{v.body}</p>
          </NotchCard>
        </BlurFade>
      {/each}
    </div>
  </Section>

  <VsHelpDocs bgClass="bg-gray-50" showHeading={true} />

  <Section>
    <SectionHeader
      eyebrow={$t('vs_help_docs.tool_by_tool')}
      eyebrowClass="text-blue-700"
      titleClass=""
      class="mb-12 md:mb-16"
    >
      {#snippet title()}{$t('vs_help_docs.what_the_popular_help_doc_tools')}{/snippet}
    </SectionHeader>

    <div class="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
      {#each competitors as competitor, i}
        <BlurFade delay={0.08 * i} once class="h-full">
          <div class="flex h-full flex-col rounded-xl border border-gray-200 bg-white p-6 md:p-7">
            <p class="text-card-title font-medium text-gray-950">{competitor.name}</p>
            <div class="mt-6">
              <p class="text-tag font-mono text-emerald-600 uppercase">{$t('vs_help_docs.where_it_wins')}</p>
              <p class="mt-2 text-[15px] leading-relaxed text-gray-600">{competitor.good}</p>
            </div>
            <div class="mt-6">
              <p class="text-tag font-mono text-rose-600 uppercase">{$t('vs_help_docs.where_it_doesn_t')}</p>
              <p class="mt-2 text-[15px] leading-relaxed text-gray-600">{competitor.missing}</p>
            </div>
          </div>
        </BlurFade>
      {/each}
    </div>
  </Section>

  <PageSignupCTA
    header={$t('vs_help_docs.stop_forwarding_help_articles_to_every')}
    subText={$t('vs_help_docs.bundle_the_articles_into_a_real')}
    btnLabel={$t('vs_help_docs.book_a_demo')}
  />
</section>
