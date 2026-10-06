<script lang="ts">
  import { t } from '$lib/i18n';
  import { SALES_EMAIL } from '@cio/utils/constants';
  import { Faq, FeatureGrid, PageHeader, PageSignupCTA, TrustBand, WorkflowSteps } from '$lib/components';
  import { Badge } from '@cio/ui/base/badge';
  import { CtaButton, Eyebrow, Section, SectionHeader } from '$lib/components/ui';
  import { BlurFade } from '@cio/ui/custom/animation/blurfade';
  import Check from '@lucide/svelte/icons/check';
  import Globe from '@lucide/svelte/icons/globe';
  import GraduationCap from '@lucide/svelte/icons/graduation-cap';
  import MoonStar from '@lucide/svelte/icons/moon-star';
  import Palette from '@lucide/svelte/icons/palette';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Users from '@lucide/svelte/icons/users';
  import Zap from '@lucide/svelte/icons/zap';

  const creatorUseCases = [
    $t('public_courses.creatorUseCases.0'),
    $t('public_courses.creatorUseCases.1'),
    $t('public_courses.creatorUseCases.2'),
    $t('public_courses.creatorUseCases.3'),
    $t('public_courses.creatorUseCases.4')
  ];

  const learnerUseCases = [
    $t('public_courses.learnerUseCases.0'),
    $t('public_courses.learnerUseCases.1'),
    $t('public_courses.learnerUseCases.2'),
    $t('public_courses.learnerUseCases.3'),
    $t('public_courses.learnerUseCases.4')
  ];

  const keyFeatures = [
    {
      Icon: Palette,
      title: $t('public_courses.keyFeatures.0.title'),
      description: $t('public_courses.keyFeatures.0.description')
    },
    {
      Icon: MoonStar,
      title: $t('public_courses.keyFeatures.1.title'),
      description: $t('public_courses.keyFeatures.1.description')
    },
    {
      Icon: Sparkles,
      title: $t('public_courses.keyFeatures.2.title'),
      description: $t('public_courses.keyFeatures.2.description')
    },
    {
      Icon: Zap,
      title: $t('public_courses.keyFeatures.3.title'),
      description: $t('public_courses.keyFeatures.3.description')
    }
  ];

  const conversionMechanics = [
    {
      title: $t('public_courses.conversionMechanics.0.title'),
      description: $t('public_courses.conversionMechanics.0.description')
    },
    {
      title: $t('public_courses.conversionMechanics.1.title'),
      description: $t('public_courses.conversionMechanics.1.description')
    },
    {
      title: $t('public_courses.conversionMechanics.2.title'),
      description: $t('public_courses.conversionMechanics.2.description')
    },
    {
      title: $t('public_courses.conversionMechanics.3.title'),
      description: $t('public_courses.conversionMechanics.3.description')
    }
  ];

  const brandingItems = [
    $t('public_courses.brandingItems.0'),
    $t('public_courses.brandingItems.1'),
    $t('public_courses.brandingItems.2'),
    $t('public_courses.brandingItems.3'),
    $t('public_courses.brandingItems.4')
  ];

  const workflow = [
    {
      title: $t('public_courses.workflow.0.title'),
      description: $t('public_courses.workflow.0.description'),
      label: $t('public_courses.workflow.0.label')
    },
    {
      title: $t('public_courses.workflow.1.title'),
      description: $t('public_courses.workflow.1.description'),
      label: $t('public_courses.workflow.1.label')
    },
    {
      title: $t('public_courses.workflow.2.title'),
      description: $t('public_courses.workflow.2.description'),
      label: $t('public_courses.workflow.2.label')
    },
    {
      title: $t('public_courses.workflow.3.title'),
      description: $t('public_courses.workflow.3.description'),
      label: $t('public_courses.workflow.3.label')
    }
  ];

  const publicCoursesFaqs = [
    {
      question: $t('public_courses.publicCoursesFaqs.0.question'),
      answer: $t('public_courses.publicCoursesFaqs.0.answer')
    },
    {
      question: $t('public_courses.publicCoursesFaqs.1.question'),
      answer: $t('public_courses.publicCoursesFaqs.1.answer')
    },
    {
      question: $t('public_courses.publicCoursesFaqs.2.question'),
      answer: $t('public_courses.publicCoursesFaqs.2.answer')
    },
    {
      question: $t('public_courses.publicCoursesFaqs.3.question'),
      answer: $t('public_courses.publicCoursesFaqs.3.answer')
    },
    {
      question: $t('public_courses.publicCoursesFaqs.4.question'),
      answer: $t('public_courses.publicCoursesFaqs.4.answer')
    },
    {
      question: $t('public_courses.publicCoursesFaqs.5.question'),
      answer: $t('public_courses.publicCoursesFaqs.5.answer')
    },
    {
      question: $t('public_courses.publicCoursesFaqs.6.question'),
      answer: $t('public_courses.publicCoursesFaqs.6.answer')
    }
  ];
</script>

<svelte:head>
  <title>{$t('public_courses.public_courses_classroomhub')}</title>
  <meta name="description" content={$t('public_courses.meta_description')} />
  <meta property="og:title" content={$t('public_courses.public_courses_classroomhub')} />
  <meta property="og:description" content={$t('public_courses.og_description')} />
</svelte:head>

<section class="bg-white">
  <PageHeader className="px-6 md:px-10">
    <div class="mx-auto flex max-w-[1000px] flex-col items-center text-center">
      <Badge
        variant="outline"
        class="text-label mb-6 gap-2! rounded-full! bg-white px-3.5! py-1.5! font-mono uppercase"
      >
        <Globe size={14} class="text-blue-700" />
        {$t('public_courses.public_courses')}
      </Badge>

      <h1 class="text-display text-balance text-gray-950">{$t('public_courses.publish_free_courses_that_lead_to')}</h1>

      <p class="text-lead mt-6 max-w-[680px] text-pretty">
        {$t('public_courses.public_courses_let_you_share_lessons')}
      </p>

      <div class="mt-9 flex flex-wrap items-center justify-center gap-3">
        <CtaButton data-cal-config="'layout':'month_view'" href="mailto:{SALES_EMAIL}?subject=ClassroomHub demo"
          >{$t('public_courses.book_a_demo')}</CtaButton
        >
        <CtaButton href="/signup" variant="secondary">{$t('public_courses.start_free')}</CtaButton>
      </div>
    </div>

    <div class="max-w-content mx-auto mt-16 w-full">
      <img
        src="/assets/assets/www/public-courses/public-courses-hero.jpeg"
        alt={$t('public_courses.public_course_page_on_desktop')}
        width="1920"
        height="1481"
        loading="eager"
        class="w-full rounded-xl border border-gray-200"
      />
    </div>
  </PageHeader>

  <Section class="bg-gray-50">
    <SectionHeader
      eyebrow={$t('public_courses.why_teams_use_it')}
      eyebrowClass="text-blue-700"
      ledeClass="text-gray-500"
      lede={$t('public_courses.teams_use_them_to_share_sample')}
    >
      {#snippet title()}
        {$t('public_courses.public_courses_are_useful_before_someone')}
      {/snippet}
    </SectionHeader>

    <div class="mt-16 grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-0 lg:divide-x lg:divide-gray-200">
      <div class="flex flex-col rounded-xl border border-gray-200 bg-white p-8 lg:rounded-r-none lg:border-r-0">
        <p class="text-label font-mono text-blue-700 uppercase">{$t('public_courses.for_creators')}</p>
        <h3 class="text-h4 mt-4 font-medium text-gray-950">
          {$t('public_courses.a_practical_way_to_publish_useful')}
        </h3>

        <div class="my-7 border-t border-gray-200"></div>

        <ul class="space-y-4">
          {#each creatorUseCases as useCase}
            <li class="flex items-start gap-3 text-[15px] leading-relaxed text-gray-700">
              <span
                class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700"
              >
                <Check size={12} strokeWidth={2.5} />
              </span>
              {useCase}
            </li>
          {/each}
        </ul>

        <div class="mt-auto pt-8">
          <span
            class="text-tag inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1.5 font-mono text-blue-700 uppercase"
          >
            <GraduationCap size={13} strokeWidth={2} />
            {$t('public_courses.shareable_by_default')}
          </span>
        </div>
      </div>

      <div class="flex flex-col rounded-xl border border-gray-200 bg-white p-8 lg:rounded-l-none lg:border-l-0">
        <p class="text-label font-mono text-emerald-700 uppercase">{$t('public_courses.for_learners')}</p>
        <h3 class="text-h4 mt-4 font-medium text-gray-950">
          {$t('public_courses.a_simple_course_page_that_is')}
        </h3>

        <div class="my-7 border-t border-gray-200"></div>

        <ul class="space-y-4">
          {#each learnerUseCases as useCase}
            <li class="flex items-start gap-3 text-[15px] leading-relaxed text-gray-700">
              <span
                class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"
              >
                <Check size={12} strokeWidth={2.5} />
              </span>
              {useCase}
            </li>
          {/each}
        </ul>

        <div class="mt-auto pt-8">
          <span
            class="text-tag inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 font-mono text-emerald-700 uppercase"
          >
            <Users size={13} strokeWidth={2} />
            {$t('public_courses.no_login_wall')}
          </span>
        </div>
      </div>
    </div>
  </Section>

  <FeatureGrid
    eyebrow={$t('public_courses.what_you_get')}
    title={$t('public_courses.the_essentials_are_already_built_in')}
    description={$t('public_courses.you_do_not_need_a_separate')}
    features={keyFeatures}
    columns={4}
  />

  <Section class="bg-white" innerClass="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-20">
    <div>
      <Eyebrow class="text-blue-700">{$t('public_courses.moving_people_forward')}</Eyebrow>
      <h2 class="text-h3 mt-4 text-balance">{$t('public_courses.if_someone_wants_more_you_can')}</h2>
      <p class="text-lead mt-[18px] text-pretty text-gray-500">
        {$t('public_courses.public_courses_are_useful_on_their')}
      </p>
      <ul class="mt-8 space-y-3 text-[15px] leading-relaxed text-gray-700">
        {#each conversionMechanics as item, i}
          <BlurFade delay={0.06 * i} once>
            <li class="flex gap-3">
              <span class="mt-2 inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-blue-700"></span>
              <span>
                <span class="font-medium text-gray-950">{item.title}.</span>
                <span class="ml-1 text-gray-500">{item.description}</span>
              </span>
            </li>
          </BlurFade>
        {/each}
      </ul>
    </div>
    <img
      src="/assets/assets/www/public-courses/public-course-empty-state.jpeg"
      alt={$t('public_courses.public_course_empty_state_in_the')}
      width="1920"
      height="1410"
      loading="lazy"
      class="w-full rounded-xl border border-gray-200"
    />
  </Section>

  <TrustBand caption={$t('public_courses.branding_options')} items={brandingItems} />

  <WorkflowSteps
    eyebrow={$t('public_courses.how_it_works')}
    title={$t('public_courses.set_it_up_in_the_same')}
    description={$t('public_courses.you_do_not_need_a_second')}
    steps={workflow}
  />

  <section class="bg-white px-6 lg:px-12">
    <Faq
      heading={$t('public_courses.faq_heading')}
      subheading={$t('public_courses.faq_subheading')}
      items={publicCoursesFaqs}
      hideCta
    />
  </section>

  <PageSignupCTA
    header={$t('public_courses.publish_a_public_course_without_spinning')}
    subText={$t('public_courses.use_the_same_classroomhub_workspace_to')}
    btnLabel={$t('public_courses.book_a_demo')}
  />
</section>
