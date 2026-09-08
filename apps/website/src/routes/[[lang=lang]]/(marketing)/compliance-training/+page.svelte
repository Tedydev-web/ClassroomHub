<script>
  import { t } from '$lib/i18n';
  import { SALES_EMAIL } from '@cio/utils/constants';
  import {
    AiTutorSection,
    CertificateMock,
    FeatureGrid,
    HeroSubtitle,
    ImageDemoSection,
    PageHeader,
    PageSignupCTA,
    SplitFeatureSection,
    TrustBand,
    WorkflowSteps
  } from '$lib/components';
  import { Badge } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import { Meteors } from '@cio/ui/custom/animation/meteors';
  import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
  import BadgeCheck from '@lucide/svelte/icons/badge-check';
  import CalendarClock from '@lucide/svelte/icons/calendar-clock';
  import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
  import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
  import FileText from '@lucide/svelte/icons/file-text';
  import GraduationCap from '@lucide/svelte/icons/graduation-cap';
  import KeyRound from '@lucide/svelte/icons/key-round';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import Users from '@lucide/svelte/icons/users';

  const workflow = [
    {
      title: $t('compliance_training.workflow.0.title'),
      description: $t('compliance_training.workflow.0.description')
    },
    {
      title: $t('compliance_training.workflow.1.title'),
      description: $t('compliance_training.workflow.1.description')
    },
    {
      title: $t('compliance_training.workflow.2.title'),
      description: $t('compliance_training.workflow.2.description')
    },
    {
      title: $t('compliance_training.workflow.3.title'),
      description: $t('compliance_training.workflow.3.description')
    }
  ];

  const features = [
    {
      Icon: ShieldCheck,
      title: $t('compliance_training.features.0.title'),
      description: $t('compliance_training.features.0.description')
    },
    {
      Icon: RefreshCw,
      title: $t('compliance_training.features.1.title'),
      description: $t('compliance_training.features.1.description')
    },
    {
      Icon: CalendarClock,
      title: $t('compliance_training.features.2.title'),
      description: $t('compliance_training.features.2.description')
    },
    {
      Icon: ClipboardCheck,
      title: $t('compliance_training.features.3.title'),
      description: $t('compliance_training.features.3.description')
    },
    {
      Icon: BadgeCheck,
      title: $t('compliance_training.features.4.title'),
      description: $t('compliance_training.features.4.description')
    },
    {
      Icon: FileSpreadsheet,
      title: $t('compliance_training.features.5.title'),
      description: $t('compliance_training.features.5.description')
    },
    {
      Icon: KeyRound,
      title: $t('compliance_training.features.6.title'),
      description: $t('compliance_training.features.6.description')
    },
    {
      Icon: Users,
      title: $t('compliance_training.features.7.title'),
      description: $t('compliance_training.features.7.description')
    }
  ];

  const questionTypes = [
    $t('compliance_training.questionTypes.0'),
    $t('compliance_training.questionTypes.1'),
    $t('compliance_training.questionTypes.2'),
    $t('compliance_training.questionTypes.3'),
    $t('compliance_training.questionTypes.4'),
    $t('compliance_training.questionTypes.5'),
    $t('compliance_training.questionTypes.6'),
    $t('compliance_training.questionTypes.7'),
    $t('compliance_training.questionTypes.8'),
    $t('compliance_training.questionTypes.9'),
    $t('compliance_training.questionTypes.10'),
    $t('compliance_training.questionTypes.11'),
    $t('compliance_training.questionTypes.12'),
    'Links',
    $t('compliance_training.questionTypes.14')
  ];

  const useCases = [
    $t('compliance_training.useCases.0'),
    $t('compliance_training.useCases.1'),
    $t('compliance_training.useCases.2'),
    $t('compliance_training.useCases.3'),
    $t('compliance_training.useCases.4'),
    $t('compliance_training.useCases.5'),
    $t('compliance_training.useCases.6'),
    $t('compliance_training.useCases.7'),
    $t('compliance_training.useCases.8'),
    $t('compliance_training.useCases.9')
  ];
</script>

<svelte:head>
  <title>{$t('compliance_training.compliance_training_classroomhub')}</title>
  <meta name="description" content={$t('compliance_training.keep_your_employees_compliant_and_track_2')} />
  <meta property="og:title" content={$t('compliance_training.keep_your_employees_compliant_and_track')} />
  <meta property="og:description" content={$t('compliance_training.turn_policies_and_sops_into_certified')} />
  <meta name="twitter:title" content={$t('compliance_training.keep_your_employees_compliant_and_track')} />
  <meta name="twitter:description" content={$t('compliance_training.turn_policies_and_sops_into_certified')} />
  <script type="module" src="/assets/assets/embeds/question-type-picker/question-type-picker.js"></script>
</svelte:head>

<section class="bg-white">
  <PageHeader className="px-6 lg:px-12">
    <div class="mx-auto flex max-w-[820px] flex-col items-center text-center">
      <Badge variant="outline" class="mb-6 gap-2! bg-white px-3.5! py-1.5!">
        <span class="relative flex h-2 w-2">
          <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-500 opacity-75"></span>
          <span class="relative inline-flex h-2 w-2 rounded-full bg-blue-600"></span>
        </span>
        {$t('compliance_training.compliance_training')}
      </Badge>
      <h1 class="text-[clamp(2rem,3.4vw,2.8rem)] leading-[1.1] font-medium tracking-tight text-gray-950">
        {$t('compliance_training.keep_your_employees_compliant_and')}
        <em class="text-blue-700 not-italic">track who's falling behind.</em>
      </h1>
      <HeroSubtitle class="mx-auto">
        {$t('compliance_training.turn_policies_sops_docs_and_videos')}
      </HeroSubtitle>
      <div class="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button data-cal-config="'layout':'month_view'" href="mailto:{SALES_EMAIL}?subject=ClassroomHub demo"
          >{$t('compliance_training.book_a_demo')}</Button
        >
        <Button href="/signup" variant="outline">{$t('compliance_training.start_free')}</Button>
      </div>
      <div class="mt-7 flex flex-wrap items-center justify-center gap-5 text-xs text-gray-500">
        <span class="flex items-center gap-1.5"
          ><span class="font-medium text-blue-700">✓</span> {$t('compliance_training.soc_2_friendly')}</span
        >
        <span class="flex items-center gap-1.5"
          ><span class="font-medium text-blue-700">✓</span> {$t('compliance_training.audit_ready_records')}</span
        >
        <span class="flex items-center gap-1.5"
          ><span class="font-medium text-blue-700">✓</span> {$t('compliance_training.your_own_domain')}</span
        >
      </div>
    </div>

    <div class="mx-auto mt-14 w-full max-w-[1100px]">
      <div class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-200">
        <img
          src="/assets/assets/www/compliance-training/org-compliance.jpeg"
          alt={$t('compliance_training.compliance_dashboard_required_learners_grouped_by')}
          class="block h-auto w-full"
          loading="eager"
          decoding="async"
        />
      </div>
    </div>
  </PageHeader>

  <TrustBand
    caption={$t('compliance_training.built_for_evidence_based_programs')}
    items={[
      'SOC 2 readiness',
      'GDPR awareness',
      'HIPAA refreshers',
      'ISO 27001 controls',
      'PCI-DSS staff training',
      'AML / KYC'
    ]}
  />

  <WorkflowSteps
    eyebrow={$t('compliance_training.how_it_works')}
    title={$t('compliance_training.from_policy_document_to_provable_completion')}
    steps={workflow}
  />

  <ImageDemoSection
    eyebrow={$t('compliance_training.inside_a_compliance_program')}
    title={$t('compliance_training.a_look_inside_a_compliance_program')}
    description={$t('compliance_training.from_importing_your_team_to_issuing')}
    imageSrc="/assets/assets/www/compliance-training/compliance-dashboard.jpeg"
    imageAlt="Compliance dashboard — required learners, status, and certificates"
  />

  <FeatureGrid
    eyebrow={$t('compliance_training.built_for_audit_pressure')}
    title={$t('compliance_training.everything_you_need_when_training_completion')}
    description={'Not a generic LMS with a "compliance" checkbox. Real workflows for the people who have to answer the auditor\u2019s questions.'}
    ctaLabel={$t('compliance_training.get_started')}
    ctaHref="/signup"
    {features}
  />

  <!-- Renewal split feature -->
  <SplitFeatureSection
    bgClass="bg-gray-50"
    eyebrow={$t('compliance_training.renewals_on_autopilot')}
    title={$t('compliance_training.training_that_re_runs_itself')}
    description={$t('compliance_training.set_a_retake_interval_once_classroomhub')}
    imageSrc="/assets/assets/www/compliance-training/course-compliance.jpeg"
    imageAlt="Compliance settings panel — retake interval, grace period, reminders, waiver rules"
  >
    {#snippet bullets()}
      <li class="flex items-start gap-2">
        <span class="mt-0.5 text-blue-700">→</span>
        {$t('compliance_training.annual_biannual_or_custom_intervals_per')}
      </li>
      <li class="flex items-start gap-2">
        <span class="mt-0.5 text-blue-700">→</span>
        {$t('compliance_training.reminder_cadences_before_expiry')}
      </li>
      <li class="flex items-start gap-2">
        <span class="mt-0.5 text-blue-700">→</span>
        {$t('compliance_training.configurable_grace_periods_and_waiver_workflows')}
      </li>
      <li class="flex items-start gap-2">
        <span class="mt-0.5 text-blue-700">→</span>
        {$t('compliance_training.pause_renewals_for_leave_role_change')}
      </li>
    {/snippet}
  </SplitFeatureSection>

  <!-- Question types showcase -->
  <section class="px-6 py-12 lg:px-12 lg:py-16">
    <div class="mx-auto max-w-[1100px]">
      <div class="mb-10 max-w-[640px]">
        <div class="mb-2 text-xs font-medium tracking-widest text-blue-700 uppercase">Assessments</div>
        <h2 class="text-[clamp(1.75rem,2.6vw,2.2rem)] leading-[1.15] font-medium tracking-tight">
          15 question types. Twelve auto-graded.
        </h2>
        <p class="mt-5 text-base leading-relaxed text-gray-500">
          {$t('compliance_training.don_t_settle_for_multiple_choice')}
        </p>
        <div class="mt-6 flex flex-wrap gap-2">
          <span class="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700"
            >{$t('compliance_training.auto_graded_12')}</span
          >
          <span class="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700"
            >{$t('compliance_training.partial_credit_9')}</span
          >
          <span class="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700"
            >{$t('compliance_training.manual_review_3')}</span
          >
        </div>
      </div>

      <div class="flex justify-center">
        <div data-cio-widget="question-type-picker" class="w-full max-w-[900px]"></div>
      </div>
    </div>
  </section>

  <!-- Certificates split -->
  <section class="bg-gray-50 px-6 py-12 lg:px-12 lg:py-16">
    <div class="mx-auto grid max-w-[1100px] grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-20">
      <div class="order-2 lg:order-1">
        <CertificateMock
          recipient="Sarah Chen"
          achievement="Annual Security Training 2026"
          issued="11 May 2026"
          verifyValue="CIO-2026-05-0142"
        />
      </div>
      <div class="order-1 lg:order-2">
        <div class="mb-2 text-xs font-medium tracking-widest text-blue-700 uppercase">
          {$t('compliance_training.certificates_evidence')}
        </div>
        <h2 class="text-[clamp(1.75rem,2.6vw,2.2rem)] leading-[1.15] font-medium tracking-tight">
          {$t('compliance_training.proof_of_training_designed_for_your')}
        </h2>
        <p class="mt-5 text-base leading-relaxed text-gray-500">
          {$t('compliance_training.configure_the_certificate_id_format_the')}
        </p>
        <ul class="mt-6 space-y-3 text-sm text-gray-700">
          <li class="flex items-start gap-2">
            <GraduationCap size={16} class="mt-0.5 text-blue-700" />
            {$t('compliance_training.templated_and_branded_with_your_logo')}
          </li>
          <li class="flex items-start gap-2">
            <BadgeCheck size={16} class="mt-0.5 text-blue-700" />
            {$t('compliance_training.tied_to_a_required_passing_score')}
          </li>
          <li class="flex items-start gap-2">
            <AlertTriangle size={16} class="mt-0.5 text-blue-700" />
            {$t('compliance_training.auto_revokes_when_a_renewal_lapses')}
          </li>
        </ul>
      </div>
    </div>
  </section>

  <AiTutorSection
    accent="In your dashboard"
    title={$t('compliance_training.a_personal_course_authoring_assistant')}
    description={$t('compliance_training.drop_in_a_policy_doc_or')}
    imageSrc="/assets/assets/www/compliance-training/ai-course-builder.jpeg"
    imageAlt="Course builder — plan, approve, implement. Templates, in-editor chat, and MCP."
  />

  <!-- Use cases -->
  <section class="px-6 py-12 lg:px-12 lg:py-16">
    <div class="mx-auto max-w-[1100px]">
      <div class="mb-10 max-w-[640px]">
        <div class="mb-2 text-xs font-medium tracking-widest text-blue-700 uppercase">
          {$t('compliance_training.use_cases')}
        </div>
        <h2 class="text-[clamp(1.75rem,2.6vw,2.2rem)] leading-[1.15] font-medium tracking-tight">
          {$t('compliance_training.training_for_the_work_people_are')}
        </h2>
      </div>

      <div class="overflow-hidden border border-gray-200 bg-white">
        <div
          class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 [&>*:nth-child(2n)]:sm:border-r-0 [&>*:nth-child(2n)]:lg:border-r [&>*:nth-child(3n)]:lg:border-r-0 [&>*:nth-last-child(-n+2)]:sm:border-b-0 [&>*:nth-last-child(-n+3)]:lg:border-b-0"
        >
          {#each useCases as useCase, i}
            <div
              class="group relative flex items-center gap-3 border-b border-gray-200 p-6 transition-colors hover:bg-gray-50/60 sm:border-r"
            >
              <span class="font-mono text-[11px] tracking-[0.15em] text-gray-400">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span class="text-sm font-medium text-gray-900">{useCase}</span>
            </div>
          {/each}
        </div>
      </div>
    </div>
  </section>

  <PageSignupCTA
    header={$t('compliance_training.keep_your_employees_compliant_and_track')}
    subText={$t('compliance_training.build_certified_training_from_your_existing')}
    btnLabel={$t('compliance_training.book_a_demo')}
  />
</section>
