<script lang="ts">
  import { PageSignupCTA, PageHeader } from '$lib/components';
  import { t } from '$lib/i18n';
  import { CtaButton, NotchCard, Section, SectionHeader } from '$lib/components/ui';
  import * as Accordion from '@cio/ui/base/accordion';

  const whyStart = $derived(
    [
      ['anywhere', '/assets/assets/www/teach/teach-from-anywhere.svg'],
      ['paid', '/assets/assets/www/teach/get-paid.svg'],
      ['inspire', '/assets/assets/www/teach/inspire-learners.svg']
    ].map(([key, src]) => ({
      src,
      header: $t(`teach.why.${key}.header`),
      subText: $t(`teach.why.${key}.subtext`)
    }))
  );

  const steps = $derived(
    ['signup', 'record', 'launch', 'sell'].map((key) => ({
      title: $t(`teach.steps.${key}.title`),
      subText: $t(`teach.steps.${key}.subtext`)
    }))
  );

  const faqs = $derived(
    ['tutors', 'equipment', 'apply', 'earn'].map((value) => ({
      value,
      question: $t(`teach.faqs.${value}.question`),
      answer: $t(`teach.faqs.${value}.answer`)
    }))
  );
</script>

<svelte:head>
  <title>{$t('teach.title')}</title>
  <meta property="og:image" itemprop="image" content="/assets/brand/og/teach.png" />
  <meta property="og:title" content={$t('teach.og_title')} />
  <meta property="og:description" content={$t('teach.og_description')} />

  <meta property="og:image:secure_url" itemprop="image" content="/assets/brand/og/teach.png" />

  <meta name="twitter:title" content={$t('teach.og_title')} />
  <meta name="twitter:description" content={$t('teach.og_description')} />
  <meta name="twitter:image" content="/assets/brand/og/teach.png" />
</svelte:head>

<section>
  <PageHeader className="mx-auto max-w-content px-6 md:px-10">
    <div class="grid items-center gap-12 lg:grid-cols-[1.15fr_1fr]">
      <div class="flex flex-col items-center text-center lg:items-start lg:text-left">
        <h1 class="text-display text-balance">{$t('teach.heading')}</h1>
        <p class="text-lead mt-6 max-w-[580px] text-pretty">
          {$t('teach.subhead')}
        </p>

        <div class="mt-9">
          <CtaButton href="/teach/register" target="_blank">{$t('teach.register')}</CtaButton>
        </div>
      </div>

      <div>
        <img src="/assets/assets/www/teach/teacher-hero.png" alt="" class="w-full" />
      </div>
    </div>
  </PageHeader>

  <Section class="border-b border-slate-100">
    <SectionHeader titleClass="">
      {#snippet title()}
        <span class="inline-flex items-center justify-center gap-3">
          {$t('teach.why_heading')} <img src="/assets/assets/www/teach/star.svg" alt="" />
        </span>
      {/snippet}
    </SectionHeader>

    <div class="mt-16 grid gap-6 md:grid-cols-3">
      {#each whyStart as why}
        <NotchCard class="h-full items-center gap-5 bg-gray-50 text-center">
          <img src={why.src} alt="" class="size-20" />
          <div>
            <h3 class="text-card-title font-medium">{why.header}</h3>
            <p class="mt-2 text-[15px] leading-relaxed">
              {why.subText}
            </p>
          </div>
        </NotchCard>
      {/each}
    </div>
  </Section>

  <Section>
    <SectionHeader titleClass="">
      {#snippet title()}
        <span class="inline-flex items-center justify-center gap-3">
          {$t('teach.steps_heading')} <img src="/assets/assets/www/teach/thumbs-up.svg" alt="" />
        </span>
      {/snippet}
    </SectionHeader>

    <div class="mt-16 grid gap-6 md:grid-cols-2">
      {#each steps as step, i}
        <NotchCard class="h-full bg-gray-50">
          <h3 class="text-h4 flex items-center font-medium">
            <span class="rounded-tag mr-3 bg-[#F7F7F7] px-2 py-1 font-mono text-base ring-1 ring-gray-200">{i + 1}</span
            >
            {step.title}
          </h3>
          <p class="mt-4 text-base leading-relaxed text-gray-600">
            {step.subText}
          </p>
        </NotchCard>
      {/each}
    </div>
    <div class="mt-12 flex justify-center">
      <CtaButton href="/teach/register" target="_blank" rel="noopener noreferrer nofollow"
        >{$t('teach.get_started')}</CtaButton
      >
    </div>
  </Section>

  <Section innerClass="grid gap-10 lg:grid-cols-12 lg:gap-12">
    <div class="lg:col-span-4">
      <h2 class="text-h3 text-balance lg:sticky lg:top-28">{$t('teach.faq_heading')}</h2>
    </div>

    <div class="lg:col-span-8">
      <Accordion.Root type="single" class="w-full">
        {#each faqs as faq}
          <Accordion.Item value={faq.value}>
            <Accordion.Trigger class="text-left">
              {faq.question}
            </Accordion.Trigger>
            <Accordion.Content>
              {faq.answer}
            </Accordion.Content>
          </Accordion.Item>
        {/each}
      </Accordion.Root>
    </div>
  </Section>

  <PageSignupCTA
    header={$t('teach.cta_header')}
    subText={$t('teach.cta_subtext')}
    btnLabel={$t('teach.register')}
    link="/teach/register"
    demo={false}
  />
</section>
