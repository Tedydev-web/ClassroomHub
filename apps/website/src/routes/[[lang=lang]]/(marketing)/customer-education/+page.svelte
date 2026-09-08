<script>
  import { t } from '$lib/i18n';
  import { SALES_EMAIL } from '@cio/utils/constants';
  import {
    AiTutorSection,
    BoxedGrid,
    CertificateMock,
    EmbedCodePreview,
    FeatureGrid,
    HeroSubtitle,
    ImageDemoSection,
    LanguageReel,
    MultiAcademySection,
    PageHeader,
    PageSignupCTA,
    RoiBand,
    TrustBand,
    VsHelpDocs,
    WorkflowSteps
  } from '$lib/components';
  import { Badge } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import { Meteors } from '@cio/ui/custom/animation/meteors';
  import BarChart3 from '@lucide/svelte/icons/bar-chart-3';
  import BookMarked from '@lucide/svelte/icons/book-marked';
  import Bot from '@lucide/svelte/icons/bot';
  import Code2 from '@lucide/svelte/icons/code-2';
  import Crown from '@lucide/svelte/icons/crown';
  import GraduationCap from '@lucide/svelte/icons/graduation-cap';
  import Languages from '@lucide/svelte/icons/languages';
  import MessagesSquare from '@lucide/svelte/icons/messages-square';
  import MonitorPlay from '@lucide/svelte/icons/monitor-play';
  import PanelTop from '@lucide/svelte/icons/panel-top';

  const workflow = [
    {
      title: $t('customer_education.workflow.0.title'),
      description: $t('customer_education.workflow.0.description')
    },
    {
      title: $t('customer_education.workflow.1.title'),
      description: $t('customer_education.workflow.1.description')
    },
    {
      title: $t('customer_education.workflow.2.title'),
      description: $t('customer_education.workflow.2.description')
    },
    {
      title: $t('customer_education.workflow.3.title'),
      description: $t('customer_education.workflow.3.description')
    }
  ];

  const features = [
    {
      Icon: PanelTop,
      title: $t('customer_education.features.0.title'),
      description: $t('customer_education.features.0.description')
    },
    {
      Icon: MonitorPlay,
      title: $t('customer_education.features.1.title'),
      description: $t('customer_education.features.1.description')
    },
    {
      Icon: BookMarked,
      title: $t('customer_education.features.2.title'),
      description: $t('customer_education.features.2.description')
    },
    {
      Icon: Bot,
      title: $t('customer_education.features.3.title'),
      description: $t('customer_education.features.3.description')
    },
    {
      Icon: MessagesSquare,
      title: $t('customer_education.features.4.title'),
      description: $t('customer_education.features.4.description')
    },
    {
      Icon: GraduationCap,
      title: $t('customer_education.features.5.title'),
      description: $t('customer_education.features.5.description')
    },
    {
      Icon: Code2,
      title: $t('customer_education.features.6.title'),
      description: $t('customer_education.features.6.description')
    },
    {
      Icon: BarChart3,
      title: $t('customer_education.features.7.title'),
      description: $t('customer_education.features.7.description')
    },
    {
      Icon: Languages,
      title: $t('customer_education.features.8.title'),
      description: $t('customer_education.features.8.description')
    }
  ];

  const langs = [
    {
      code: 'en',
      native: $t('customer_education.langs.0.native'),
      en: $t('customer_education.langs.0.en'),
      sample: $t('customer_education.langs.0.sample'),
      tone: 'from-blue-100 to-blue-200',
      ring: 'ring-blue-200'
    },
    {
      code: 'es',
      native: $t('customer_education.langs.1.native'),
      en: $t('customer_education.langs.1.en'),
      sample: $t('customer_education.langs.1.sample'),
      tone: 'from-amber-100 to-rose-200',
      ring: 'ring-amber-200'
    },
    {
      code: 'pt',
      native: $t('customer_education.langs.2.native'),
      en: $t('customer_education.langs.2.en'),
      sample: $t('customer_education.langs.2.sample'),
      tone: 'from-emerald-100 to-teal-200',
      ring: 'ring-emerald-200'
    },
    {
      code: 'de',
      native: $t('customer_education.langs.3.native'),
      en: $t('customer_education.langs.3.en'),
      sample: $t('customer_education.langs.3.sample'),
      tone: 'from-slate-100 to-slate-200',
      ring: 'ring-slate-200'
    },
    {
      code: 'fr',
      native: $t('customer_education.langs.4.native'),
      en: $t('customer_education.langs.4.en'),
      sample: $t('customer_education.langs.4.sample'),
      tone: 'from-blue-100 to-indigo-200',
      ring: 'ring-indigo-200'
    },
    {
      code: 'hi',
      native: 'हिन्दी',
      en: 'Hindi',
      sample: 'शुरुआत: आपका पहला वर्कस्पेस',
      tone: 'from-orange-100 to-rose-200',
      ring: 'ring-orange-200'
    },
    {
      code: 'vi',
      native: $t('customer_education.langs.6.native'),
      en: $t('customer_education.langs.6.en'),
      sample: $t('customer_education.langs.6.sample'),
      tone: 'from-red-100 to-yellow-200',
      ring: 'ring-red-200'
    },
    {
      code: 'ru',
      native: 'Русский',
      en: $t('customer_education.langs.7.en'),
      sample: 'Начало работы: ваше рабочее пространство',
      tone: 'from-sky-100 to-blue-200',
      ring: 'ring-sky-200'
    },
    {
      code: 'pl',
      native: $t('customer_education.langs.8.native'),
      en: $t('customer_education.langs.8.en'),
      sample: $t('customer_education.langs.8.sample'),
      tone: 'from-rose-100 to-red-200',
      ring: 'ring-rose-200'
    },
    {
      code: 'da',
      native: 'Dansk',
      en: $t('customer_education.langs.9.en'),
      sample: $t('customer_education.langs.9.sample'),
      tone: 'from-red-100 to-rose-200',
      ring: 'ring-red-200'
    }
  ];

  const outcomes = [
    { title: $t('customer_education.outcomes.0'), sub: $t('customer_education.outcomes.0') },
    { title: $t('customer_education.outcomes.1'), sub: $t('customer_education.outcomes.1') },
    { title: $t('customer_education.outcomes.2'), sub: $t('customer_education.outcomes.2') },
    { title: $t('customer_education.outcomes.3'), sub: $t('customer_education.outcomes.3') },
    { title: $t('customer_education.outcomes.4'), sub: $t('customer_education.outcomes.4') },
    { title: $t('customer_education.outcomes.5'), sub: $t('customer_education.outcomes.5') }
  ];
</script>

<svelte:head>
  <title>{$t('customer_education.customer_academy_software_for_saas_classroomhub')}</title>
  <meta name="description" content={$t('customer_education.launch_a_branded_customer_academy_onboarding')} />
</svelte:head>

<section class="bg-white">
  <PageHeader className="px-6 lg:px-12">
    <div class="mx-auto flex max-w-[820px] flex-col items-center text-center">
      <Badge variant="outline" class="mb-6 gap-2! bg-white px-3.5! py-1.5!">
        <Crown size={14} class="text-blue-700" />
        {$t('customer_education.customer_education')}
      </Badge>
      <h1 class="text-[clamp(2rem,3.4vw,2.8rem)] leading-[1.1] font-medium tracking-tight text-gray-950">
        {$t('customer_education.launch_a_customer_academy')}
        <em class="text-blue-700 not-italic">customers actually love.</em>
      </h1>
      <HeroSubtitle class="mx-auto">
        {$t('customer_education.turn_your_help_docs_onboarding_videos')}
      </HeroSubtitle>
      <div class="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button data-cal-config="'layout':'month_view'" href="mailto:{SALES_EMAIL}?subject=ClassroomHub demo"
          >{$t('customer_education.book_a_demo')}</Button
        >
        <Button href="/signup" variant="outline">{$t('customer_education.start_free')}</Button>
      </div>
      <div class="mt-7 flex flex-wrap items-center justify-center gap-5 text-xs text-gray-500">
        <span class="flex items-center gap-1.5"
          ><span class="font-medium text-blue-700">✓</span> {$t('customer_education.custom_domain')}</span
        >
        <span class="flex items-center gap-1.5"
          ><span class="font-medium text-blue-700">✓</span> {$t('customer_education.embed_anywhere')}</span
        >
        <span class="flex items-center gap-1.5"
          ><span class="font-medium text-blue-700">✓</span> {$t('customer_education.ai_in_every_lesson')}</span
        >
      </div>
    </div>

    <div class="mx-auto mt-14 w-full max-w-[1100px]">
      <div class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-200">
        <img
          src="/assets/assets/www/customer-education/beautiful-academy-site.jpeg"
          alt={$t('customer_education.branded_customer_academy_on_a_custom')}
          class="block h-auto w-full"
          loading="eager"
          decoding="async"
        />
      </div>
    </div>
  </PageHeader>

  <TrustBand
    caption={$t('customer_education.built_for_product_led_teams')}
    items={[
      'SaaS onboarding',
      'Developer tools',
      'B2B platforms',
      'Admin training',
      'Customer champions',
      'Open-source projects'
    ]}
  />

  <RoiBand bgClass="bg-white" />

  <WorkflowSteps
    eyebrow={$t('customer_education.how_it_works')}
    title={$t('customer_education.from_scattered_docs_to_a_polished')}
    steps={workflow}
  />

  <ImageDemoSection
    eyebrow={$t('customer_education.make_it_yours')}
    title={$t('customer_education.customize_how_your_customer_academy_looks')}
    description={$t('customer_education.theme_the_catalog_swap_fonts_and')}
    imageSrc="/assets/assets/www/customer-education/customizable-academy.jpeg"
    imageAlt="Customizable customer academy — catalog, course page, certificate"
  />

  <FeatureGrid
    eyebrow={$t('customer_education.every_piece_included')}
    title={$t('customer_education.everything_you_need_to_teach_customers')}
    description={'Not a "content site" bolted onto your help docs. A real LMS with cohorts, assessments, certificates, AI tutoring, community, and analytics, wrapped in your brand.'}
    ctaLabel={$t('customer_education.get_started')}
    ctaHref="/signup"
    {features}
  />

  <AiTutorSection
    accent=""
    title={$t('customer_education.an_ai_tutor_in_every_lesson')}
    description={$t('customer_education.an_ai_tutor_sits_inside_every')}
    imagePath="/static/ai-tutor-stack.png"
    imageCaption="AI tutor in a lesson — lesson-aware chat, follow-ups, translation, summarisation"
    vimeoVideoId="1192910311"
  />

  <LanguageReel
    {langs}
    eyebrow={$t('customer_education.global_customers')}
    headlineLead="Teach customers"
    headlineAccent="in the language they bought in."
    description={$t('customer_education.author_once_publish_in_ten_each')}
    moduleLabel="Lesson 1 · Onboarding"
    footerLabel="6 lessons · 18 min"
    bgClass="bg-white"
  />

  <EmbedCodePreview
    eyebrow={$t('customer_education.embed_anywhere')}
    title={$t('customer_education.bring_lessons_to_your_help_center')}
    description={$t('customer_education.publish_any_course_as_a_widget')}
    fileName="help-center.html"
    codeLines={[
      '<span class="text-slate-500">&lt;!-- in your help center --&gt;</span>',
      '<span class="text-pink-400">&lt;script</span> <span class="text-sky-300">src</span><span class="text-slate-500">=</span><span class="text-emerald-300">"https://classroom-embed.tedydev.io.vn/course-widget"</span><span class="text-pink-400">&gt;&lt;/script&gt;</span>',
      '',
      '<span class="text-pink-400">&lt;div</span> <span class="text-sky-300">data-cio-widget</span><span class="text-slate-500">=</span><span class="text-emerald-300">"getting-started"</span>',
      '  <span class="text-sky-300">data-org</span><span class="text-slate-500">=</span><span class="text-emerald-300">"yourcompany"</span>',
      '  <span class="text-sky-300">data-theme</span><span class="text-slate-500">=</span><span class="text-emerald-300">"light"</span><span class="text-pink-400">&gt;</span>',
      '<span class="text-pink-400">&lt;/div&gt;</span>'
    ]}
    statusBar="connected · org: yourcompany · widget: getting-started"
    previewUrl="help.yourcompany.com / getting-started"
    previewImageSrc="/assets/assets/www/customer-education/embeddable-widget.jpeg"
    previewAlt="Lesson widget embedded inside a help-center page"
    capabilities={[
      { label: 'One script tag', sub: 'Drop-in install, no SDK required' },
      { label: 'Select from multiple themes', sub: 'Light, dark, and brand-tuned looks bundled in' },
      { label: 'Sync back to CIO', sub: 'Progress, marks, and certs round-trip' }
    ]}
    bgClass="bg-gray-50"
  />

  <!-- Cohorts / certificates split -->
  <section class="px-6 py-12 lg:px-12 lg:py-16">
    <div class="mx-auto grid max-w-[1100px] grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-20">
      <div>
        <div class="mb-2 text-xs font-medium tracking-widest text-blue-700 uppercase">
          {$t('customer_education.certified_champions')}
        </div>
        <h2 class="text-[clamp(1.75rem,2.6vw,2.2rem)] leading-[1.15] font-medium tracking-tight">
          {$t('customer_education.turn_power_users_into_a_public')}
        </h2>
        <p class="mt-5 text-base leading-relaxed text-gray-500">
          {$t('customer_education.bundle_courses_into_cohorts_gate_them')}
        </p>
        <ul class="mt-6 space-y-3 text-sm text-gray-700">
          <li class="flex items-start gap-2">
            <GraduationCap size={16} class="mt-0.5 text-blue-700" />
            {$t('customer_education.branded_pdf_png_certificates_with_verifiable')}
          </li>
          <li class="flex items-start gap-2">
            <BookMarked size={16} class="mt-0.5 text-blue-700" />
            {$t('customer_education.cohorts_with_required_completion_order')}
          </li>
          <li class="flex items-start gap-2">
            <MessagesSquare size={16} class="mt-0.5 text-blue-700" />
            {$t('customer_education.per_course_q_a_and_cohort')}
          </li>
        </ul>
      </div>
      <CertificateMock
        recipient="Alex Rivera"
        achievement="YourCo Admin Bootcamp · 2026"
        issued="11 May 2026"
        verifyValue="CIO-2026-05-0214"
      />
    </div>
  </section>

  <!-- Outcomes -->
  <section class="bg-gray-50 px-6 py-12 lg:px-12 lg:py-16">
    <div class="mx-auto max-w-[1100px]">
      <div class="mb-10 max-w-[640px]">
        <div class="mb-2 text-xs font-medium tracking-widest text-blue-700 uppercase">
          {$t('customer_education.why_teams_ship_this')}
        </div>
        <h2 class="text-[clamp(1.75rem,2.6vw,2.2rem)] leading-[1.15] font-medium tracking-tight">
          {$t('customer_education.educated_customers_churn_less_period')}
        </h2>
      </div>

      <BoxedGrid items={outcomes} cols={3}>
        {#snippet cell(outcome)}
          <h3 class="text-base font-medium text-gray-950">{outcome.title}</h3>
          <p class="mt-2 text-sm leading-relaxed text-gray-500">{outcome.sub}</p>
        {/snippet}
      </BoxedGrid>
    </div>
  </section>

  <VsHelpDocs bgClass="bg-white" />

  <MultiAcademySection />

  <PageSignupCTA
    header={$t('customer_education.launch_your_customer_academy')}
    subText={$t('customer_education.build_a_branded_learning_portal_customers')}
    btnLabel={$t('customer_education.book_a_demo')}
  />
</section>
