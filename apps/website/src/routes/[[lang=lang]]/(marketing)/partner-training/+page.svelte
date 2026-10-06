<script>
  import { t } from '$lib/i18n';
  import { PRODUCT_URLS, SALES_EMAIL } from '@cio/utils/constants';
  import {
    EmbedCodePreview,
    FeatureGrid,
    HeroSubtitle,
    ImageDemoSection,
    LanguageReel,
    PageHeader,
    PageSignupCTA,
    TrustBand,
    WorkflowSteps
  } from '$lib/components';
  import { Badge } from '@cio/ui/base/badge';
  import { CtaButton, Section, SectionHeader } from '$lib/components/ui';
  import { Meteors } from '@cio/ui/custom/animation/meteors';
  import BadgeCheck from '@lucide/svelte/icons/badge-check';
  import BookOpenCheck from '@lucide/svelte/icons/book-open-check';
  import Boxes from '@lucide/svelte/icons/boxes';
  import ChartNoAxesCombined from '@lucide/svelte/icons/chart-no-axes-combined';
  import Code2 from '@lucide/svelte/icons/code-2';
  import Globe from '@lucide/svelte/icons/globe';
  import Languages from '@lucide/svelte/icons/languages';
  import Layers from '@lucide/svelte/icons/layers';
  import MessageSquareText from '@lucide/svelte/icons/message-square-text';
  import Share2 from '@lucide/svelte/icons/share-2';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Trophy from '@lucide/svelte/icons/trophy';

  const steps = [
    {
      title: $t('partner_training.steps.0.title'),
      description: $t('partner_training.steps.0.description')
    },
    {
      title: $t('partner_training.steps.1.title'),
      description: $t('partner_training.steps.1.description')
    },
    {
      title: $t('partner_training.steps.2.title'),
      description: $t('partner_training.steps.2.description')
    },
    {
      title: $t('partner_training.steps.3.title'),
      description: $t('partner_training.steps.3.description')
    }
  ];

  const features = [
    {
      Icon: Layers,
      title: $t('partner_training.features.0.title'),
      description: $t('partner_training.features.0.description')
    },
    {
      Icon: BadgeCheck,
      title: $t('partner_training.features.1.title'),
      description: $t('partner_training.features.1.description')
    },
    {
      Icon: Globe,
      title: $t('partner_training.features.2.title'),
      description: $t('partner_training.features.2.description')
    },
    {
      Icon: Share2,
      title: $t('partner_training.features.3.title'),
      description: $t('partner_training.features.3.description')
    },
    {
      Icon: Languages,
      title: $t('partner_training.features.4.title'),
      description: $t('partner_training.features.4.description')
    },
    {
      Icon: ChartNoAxesCombined,
      title: $t('partner_training.features.5.title'),
      description: $t('partner_training.features.5.description')
    },
    {
      Icon: MessageSquareText,
      title: $t('partner_training.features.6.title'),
      description: $t('partner_training.features.6.description')
    },
    {
      Icon: Boxes,
      title: $t('partner_training.features.7.title'),
      description: $t('partner_training.features.7.description')
    }
  ];

  const langs = [
    {
      code: 'en',
      native: $t('partner_training.langs.0.native'),
      en: $t('partner_training.langs.0.en'),
      sample: $t('partner_training.langs.0.sample'),
      tone: 'from-blue-100 to-blue-200',
      ring: 'ring-blue-200'
    },
    {
      code: 'es',
      native: $t('partner_training.langs.1.native'),
      en: $t('partner_training.langs.1.en'),
      sample: $t('partner_training.langs.1.sample'),
      tone: 'from-amber-100 to-rose-200',
      ring: 'ring-amber-200'
    },
    {
      code: 'pt',
      native: $t('partner_training.langs.2.native'),
      en: $t('partner_training.langs.2.en'),
      sample: $t('partner_training.langs.2.sample'),
      tone: 'from-emerald-100 to-teal-200',
      ring: 'ring-emerald-200'
    },
    {
      code: 'de',
      native: $t('partner_training.langs.3.native'),
      en: $t('partner_training.langs.3.en'),
      sample: $t('partner_training.langs.3.sample'),
      tone: 'from-slate-100 to-slate-200',
      ring: 'ring-slate-200'
    },
    {
      code: 'fr',
      native: $t('partner_training.langs.4.native'),
      en: $t('partner_training.langs.4.en'),
      sample: $t('partner_training.langs.4.sample'),
      tone: 'from-blue-100 to-indigo-200',
      ring: 'ring-indigo-200'
    },
    {
      code: 'hi',
      native: 'हिन्दी',
      en: 'Hindi',
      sample: 'कार्यान्वयन चेकलिस्ट',
      tone: 'from-orange-100 to-rose-200',
      ring: 'ring-orange-200'
    },
    {
      code: 'vi',
      native: $t('partner_training.langs.6.native'),
      en: $t('partner_training.langs.6.en'),
      sample: $t('partner_training.langs.6.sample'),
      tone: 'from-red-100 to-yellow-200',
      ring: 'ring-red-200'
    },
    {
      code: 'ru',
      native: 'Русский',
      en: $t('partner_training.langs.7.en'),
      sample: 'Контрольный список',
      tone: 'from-sky-100 to-blue-200',
      ring: 'ring-sky-200'
    },
    {
      code: 'pl',
      native: $t('partner_training.langs.8.native'),
      en: $t('partner_training.langs.8.en'),
      sample: $t('partner_training.langs.8.sample'),
      tone: 'from-rose-100 to-red-200',
      ring: 'ring-rose-200'
    },
    {
      code: 'da',
      native: 'Dansk',
      en: $t('partner_training.langs.9.en'),
      sample: $t('partner_training.langs.9.sample'),
      tone: 'from-red-100 to-rose-200',
      ring: 'ring-red-200'
    }
  ];
</script>

<svelte:head>
  <title>{$t('partner_training.partner_training_classroomhub')}</title>
  <meta name="description" content={$t('partner_training.run_a_partner_academy_alongside_your')} />
</svelte:head>

<section class="bg-white">
  <PageHeader className="px-6 md:px-10">
    <div class="mx-auto flex max-w-[1000px] flex-col items-center text-center">
      <Badge variant="outline" class="mb-6 gap-2! bg-white px-3.5! py-1.5!">
        <Trophy size={14} class="text-blue-700" />
        {$t('partner_training.partner_training')}
      </Badge>
      <h1 class="text-display text-balance text-gray-950">
        {$t('partner_training.train_the_partners')}
        <em class="text-blue-700 not-italic">who sell your product.</em>
      </h1>
      <HeroSubtitle class="mx-auto">
        {$t('partner_training.run_a_partner_workspace_alongside_your')}
      </HeroSubtitle>
      <div class="mt-9 flex flex-wrap items-center justify-center gap-3">
        <CtaButton data-cal-config="'layout':'month_view'" href="mailto:{SALES_EMAIL}?subject=ClassroomHub demo"
          >{$t('partner_training.book_a_demo')}</CtaButton
        >
        <CtaButton href="/signup" variant="secondary">{$t('partner_training.start_free')}</CtaButton>
      </div>
      <div
        class="text-label mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 font-mono text-gray-500 uppercase"
      >
        <span class="flex items-center gap-1.5"
          ><span class="font-medium text-blue-700">✓</span> {$t('partner_training.custom_domain')}</span
        >
        <span class="flex items-center gap-1.5"
          ><span class="font-medium text-blue-700">✓</span> {$t('partner_training.separate_workspace')}</span
        >
        <span class="flex items-center gap-1.5"><span class="font-medium text-blue-700">✓</span> Embeddable</span>
      </div>
    </div>

    <div class="max-w-content mx-auto mt-16 w-full">
      <div class="overflow-hidden rounded-xl bg-white ring-1 ring-gray-200">
        <img
          src="/assets/assets/www/partner-training/latest-courses.jpeg"
          alt={$t('partner_training.partner_academy_latest_courses_cohort_structure')}
          class="block h-auto w-full"
          loading="eager"
          decoding="async"
        />
      </div>
    </div>
  </PageHeader>

  <TrustBand
    caption={$t('partner_training.for_partner_programs_at')}
    items={[
      'SaaS platforms',
      'Fintech',
      'Developer tools',
      'Solution agencies',
      'Franchise networks',
      'Channel programs'
    ]}
  />

  <WorkflowSteps
    eyebrow={$t('partner_training.partner_enablement')}
    title={$t('partner_training.give_every_partner_the_same_starting')}
    {steps}
    bgClass="bg-gray-50"
  />

  <ImageDemoSection
    eyebrow={$t('partner_training.public_course_pages')}
    title={$t('partner_training.open_a_few_courses_to_the')}
    description={$t('partner_training.pick_the_courses_you_want_anyone')}
    imageSrc="/assets/assets/www/partner-training/public-courses.jpeg"
    imageAlt="Public partner course pages — open courses up front, sign-up gates the rest"
  />

  <FeatureGrid
    eyebrow={$t('partner_training.what_you_can_run')}
    title={$t('partner_training.certification_programs_for_the_people_who')}
    {features}
  />

  <EmbedCodePreview
    eyebrow={$t('partner_training.embed_anywhere')}
    title={$t('partner_training.drop_a_learning_widget_into_any')}
    description={$t('partner_training.generate_a_published_widget_payload_for')}
    fileName="partner-portal.html"
    codeLines={[
      '<span class="text-slate-500">&lt;!-- in your partner portal --&gt;</span>',
      `<span class="text-pink-400">&lt;script</span> <span class="text-sky-300">src</span><span class="text-slate-500">=</span><span class="text-emerald-300">"${PRODUCT_URLS.embed}/course-widget"</span><span class="text-pink-400">&gt;&lt;/script&gt;</span>`,
      '',
      '<span class="text-pink-400">&lt;div</span> <span class="text-sky-300">data-cio-widget</span><span class="text-slate-500">=</span><span class="text-emerald-300">"partner-onboarding"</span>',
      '  <span class="text-sky-300">data-org</span><span class="text-slate-500">=</span><span class="text-emerald-300">"yourcompany"</span>',
      '  <span class="text-sky-300">data-theme</span><span class="text-slate-500">=</span><span class="text-emerald-300">"light"</span>',
      '  <span class="text-sky-300">data-lang</span><span class="text-slate-500">=</span><span class="text-emerald-300">"auto"</span><span class="text-pink-400">&gt;</span>',
      '<span class="text-pink-400">&lt;/div&gt;</span>'
    ]}
    statusBar="connected · org: yourcompany · widget: partner-onboarding"
    previewUrl="partners.yourcompany.com / academy"
    previewImageSrc="/assets/assets/www/partner-training/embeddable-widget.jpeg"
    previewAlt="Course widget embedded inside a partner portal"
    capabilities={[
      { label: 'One script tag', sub: 'Drop-in install, no SDK required' },
      { label: 'Select from multiple themes', sub: 'Light, dark, and brand-tuned looks bundled in' },
      { label: 'Sync back to CIO', sub: 'Progress, marks, and certs round-trip' }
    ]}
  />

  <LanguageReel
    {langs}
    eyebrow={$t('partner_training.global_partners')}
    headlineLead="Train your network"
    headlineAccent="in their language."
    description={$t('partner_training.author_once_publish_in_ten_each')}
    moduleLabel="Module 2 · Implementation"
    footerLabel="8 lessons"
  />

  <Section innerClass="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-20">
    <div>
      <SectionHeader
        align="left"
        size="h3"
        eyebrow={$t('partner_training.readiness_analytics')}
        eyebrowClass="text-blue-700"
        titleClass=""
        ledeClass="text-gray-500"
        lede={$t('partner_training.drill_into_completion_rates_time_to')}
      >
        {#snippet title()}{$t('partner_training.see_which_partners_are_ready_to')}{/snippet}
      </SectionHeader>
      <ul class="mt-8 space-y-3 text-[15px] text-gray-700">
        <li class="flex items-start gap-2">
          <BookOpenCheck size={16} class="mt-1 shrink-0 text-blue-700" />
          {$t('partner_training.course_level_and_cohort_level_dashboards')}
        </li>
        <li class="flex items-start gap-2">
          <ChartNoAxesCombined size={16} class="mt-1 shrink-0 text-blue-700" />
          {$t('partner_training.per_learner_gradebook_with_manual_override')}
        </li>
        <li class="flex items-start gap-2">
          <MessageSquareText size={16} class="mt-1 shrink-0 text-blue-700" />
          {$t('partner_training.newsfeed_activity_and_q_a_participation')}
        </li>
      </ul>
    </div>
    <div class="relative overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div class="aspect-[4/3] w-full bg-gradient-to-br from-blue-50 via-white to-gray-50 p-6">
        <div class="grid h-full grid-cols-2 gap-3">
          <div class="rounded-md bg-white p-3 ring-1 ring-gray-100">
            <p class="text-[10px] text-gray-500">{$t('partner_training.time_to_certify')}</p>
            <p class="mt-1 text-xl font-semibold tracking-tight text-gray-950">11.2d</p>
            <p class="text-[10px] text-green-600">↓ 2.4d</p>
          </div>
          <div class="rounded-md bg-white p-3 ring-1 ring-gray-100">
            <p class="text-[10px] text-gray-500">{$t('partner_training.pass_rate')}</p>
            <p class="mt-1 text-xl font-semibold tracking-tight text-blue-700">87%</p>
          </div>
          <div class="col-span-2 rounded-md bg-white p-3 ring-1 ring-gray-100">
            <p class="mb-2 text-[10px] text-gray-500">{$t('partner_training.completion_by_partner_org')}</p>
            <div class="space-y-1.5">
              {#each [{ n: 'Northwind', v: 92 }, { n: 'Acme Resellers', v: 78 }, { n: 'Globex Implements', v: 64 }] as row}
                <div class="flex items-center gap-2">
                  <span class="w-24 text-[10px] text-gray-600">{row.n}</span>
                  <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                    <div class="h-full rounded-full bg-blue-700" style="width: {row.v}%"></div>
                  </div>
                  <span class="font-mono text-[10px] font-medium text-gray-700">{row.v}%</span>
                </div>
              {/each}
            </div>
          </div>
        </div>
      </div>
      <p class="pb-3 text-center text-xs text-gray-400">
        {$t('partner_training.replace_with_static_partner_analytics_dashboard')}
      </p>
    </div>
  </Section>

  <PageSignupCTA
    variant="brand"
    header={$t('partner_training.certify_your_next_partner_cohort')}
    subText={$t('partner_training.turn_your_product_knowledge_into_a')}
    btnLabel={$t('partner_training.book_a_demo')}
  />
</section>
