<script lang="ts">
  import { t } from '$lib/i18n';
  import { SALES_EMAIL } from '@cio/utils/constants';
  import { PageHeader, PageSignupCTA, WorkflowSteps } from '$lib/components';
  import { Badge } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import { BlurFade } from '@cio/ui/custom/animation/blurfade';
  import AlertCircle from '@lucide/svelte/icons/alert-circle';
  import BarChart3 from '@lucide/svelte/icons/bar-chart-3';
  import BookOpen from '@lucide/svelte/icons/book-open';
  import Check from '@lucide/svelte/icons/check';
  import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
  import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
  import FileText from '@lucide/svelte/icons/file-text';
  import GraduationCap from '@lucide/svelte/icons/graduation-cap';
  import Layers from '@lucide/svelte/icons/layers';
  import Route from '@lucide/svelte/icons/route';
  import Search from '@lucide/svelte/icons/search';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Users from '@lucide/svelte/icons/users';

  const quickVerdicts = [
    {
      Icon: FileText,
      title: $t('docs_vs_academy.quickVerdicts.0.title'),
      description: $t('docs_vs_academy.quickVerdicts.0.description')
    },
    {
      Icon: GraduationCap,
      title: $t('docs_vs_academy.quickVerdicts.1.title'),
      description: $t('docs_vs_academy.quickVerdicts.1.description')
    }
  ];

  const comparisonRows = [
    {
      need: '"How do I do X?"',
      docs: true,
      academy: false,
      note: $t('docs_vs_academy.comparisonRows.0.note')
    },
    {
      need: '"Teach me the product from zero"',
      docs: false,
      academy: true,
      note: $t('docs_vs_academy.comparisonRows.1.note')
    },
    {
      need: '"Prove I am an expert"',
      docs: false,
      academy: true,
      note: $t('docs_vs_academy.comparisonRows.2.note')
    },
    {
      need: '"Onboard a new partner team"',
      docs: false,
      academy: true,
      note: $t('docs_vs_academy.comparisonRows.3.note')
    },
    {
      need: '"Look something up fast"',
      docs: true,
      academy: false,
      note: $t('docs_vs_academy.comparisonRows.4.note')
    },
    {
      need: '"Make sure everyone completed required training"',
      docs: false,
      academy: true,
      note: $t('docs_vs_academy.comparisonRows.5.note')
    },
    {
      need: '"Explain a technical reference"',
      docs: true,
      academy: false,
      note: $t('docs_vs_academy.comparisonRows.6.note')
    },
    {
      need: '"Launch a repeatable customer education program"',
      docs: false,
      academy: true,
      note: $t('docs_vs_academy.comparisonRows.7.note')
    }
  ];

  const docsUseCases = [
    $t('docs_vs_academy.docsUseCases.0'),
    $t('docs_vs_academy.docsUseCases.1'),
    $t('docs_vs_academy.docsUseCases.2'),
    $t('docs_vs_academy.docsUseCases.3'),
    $t('docs_vs_academy.docsUseCases.4'),
    $t('docs_vs_academy.docsUseCases.5')
  ];

  const academyUseCases = [
    $t('docs_vs_academy.academyUseCases.0'),
    $t('docs_vs_academy.academyUseCases.1'),
    $t('docs_vs_academy.academyUseCases.2'),
    $t('docs_vs_academy.academyUseCases.3'),
    $t('docs_vs_academy.academyUseCases.4'),
    $t('docs_vs_academy.academyUseCases.5')
  ];

  const decisionSignals = [
    {
      Icon: Search,
      title: $t('docs_vs_academy.decisionSignals.0.title'),
      description: $t('docs_vs_academy.decisionSignals.0.description')
    },
    {
      Icon: Route,
      title: $t('docs_vs_academy.decisionSignals.1.title'),
      description: $t('docs_vs_academy.decisionSignals.1.description')
    },
    {
      Icon: ClipboardCheck,
      title: $t('docs_vs_academy.decisionSignals.2.title'),
      description: $t('docs_vs_academy.decisionSignals.2.description')
    },
    {
      Icon: Users,
      title: $t('docs_vs_academy.decisionSignals.3.title'),
      description: $t('docs_vs_academy.decisionSignals.3.description')
    }
  ];

  const hybridModel = [
    {
      title: $t('docs_vs_academy.hybridModel.0.title'),
      description: $t('docs_vs_academy.hybridModel.0.description')
    },
    {
      title: $t('docs_vs_academy.hybridModel.1.title'),
      description: $t('docs_vs_academy.hybridModel.1.description')
    },
    {
      title: $t('docs_vs_academy.hybridModel.2.title'),
      description: $t('docs_vs_academy.hybridModel.2.description')
    }
  ];

  const academySignals = [
    $t('docs_vs_academy.academySignals.0'),
    $t('docs_vs_academy.academySignals.1'),
    $t('docs_vs_academy.academySignals.2'),
    $t('docs_vs_academy.academySignals.3'),
    $t('docs_vs_academy.academySignals.4'),
    $t('docs_vs_academy.academySignals.5')
  ];
</script>

<svelte:head>
  <title>{$t('docs_vs_academy.docs_vs_company_academy_classroomhub')}</title>
  <meta name="description" content={$t('docs_vs_academy.a_practical_guide_to_when_your')} />
</svelte:head>

<section class="bg-white">
  <PageHeader className="px-6 lg:px-12">
    <div class="mx-auto flex max-w-[820px] flex-col items-center text-center">
      <Badge variant="outline" class="mb-6 gap-2! bg-white px-3.5! py-1.5!">
        <BookOpen size={14} class="text-blue-700" />
        {$t('docs_vs_academy.docs_vs_company_academy')}
      </Badge>

      <h1 class="text-[clamp(2.4rem,4vw,3.6rem)] leading-[1.08] font-medium tracking-tight text-gray-950">
        {$t('docs_vs_academy.documentation_answers_questions')}
        <em class="text-blue-700 not-italic">{$t('docs_vs_academy.a_company_academy_teaches_them_to')}</em>
      </h1>

      <p class="mt-6 text-sm leading-relaxed lg:text-base">
        {$t('docs_vs_academy.most_teams_do_not_need_to')}
      </p>

      <div class="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button data-cal-config="'layout':'month_view'" href="mailto:{SALES_EMAIL}?subject=ClassroomHub demo"
          >{$t('docs_vs_academy.book_a_demo')}</Button
        >
        <Button href="/customer-education" variant="outline">{$t('docs_vs_academy.explore_academies')}</Button>
      </div>
    </div>

    <div class="mx-auto mt-14 w-full max-w-[1100px]">
      <div class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-200">
        <img
          src="/assets/assets/www/docs-vs-company-academy/docs-vs-customer-site.jpeg"
          alt={$t('docs_vs_academy.docs_answering_questions_customer_academy_building')}
          class="block h-auto w-full"
          loading="eager"
          decoding="async"
        />
      </div>
    </div>
  </PageHeader>

  <section class="bg-gray-50 px-6 py-16 lg:px-12 lg:py-24">
    <div class="mx-auto max-w-[1120px]">
      <div class="mb-10 max-w-[720px]">
        <div class="mb-3 text-xs font-medium tracking-widest text-blue-700 uppercase">
          {$t('docs_vs_academy.decision_table')}
        </div>
        <h2 class="text-[clamp(2rem,3vw,2.7rem)] leading-[1.15] font-medium tracking-tight text-gray-950">
          {$t('docs_vs_academy.start_with_the_need_then_choose')}
        </h2>
        <p class="mt-5 text-base leading-relaxed text-gray-500">
          {$t('docs_vs_academy.if_the_person_wants_one_answer')}
        </p>
      </div>

      <div class="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <div
          class="grid grid-cols-[1fr_84px_96px] border-b border-gray-200 bg-gray-950 text-white md:grid-cols-[1fr_110px_130px_1.3fr]"
        >
          <div class="px-5 py-4 text-sm font-medium">Need</div>
          <div class="px-3 py-4 text-center text-sm font-medium md:px-5">Docs</div>
          <div class="px-3 py-4 text-center text-sm font-medium md:px-5">Academy</div>
          <div class="hidden px-5 py-4 text-sm font-medium md:block">Why</div>
        </div>

        {#each comparisonRows as row}
          <div
            class="grid grid-cols-[1fr_84px_96px] border-b border-gray-100 last:border-b-0 md:grid-cols-[1fr_110px_130px_1.3fr]"
          >
            <div class="bg-gray-50 px-5 py-5 text-sm font-medium text-gray-950">{row.need}</div>
            <div class="flex items-center justify-center px-3 py-5 md:px-5">
              {#if row.docs}
                <span class="text-xl text-green-600" aria-label="Yes">✓</span>
              {:else}
                <span class="text-xl text-red-500" aria-label="No">×</span>
              {/if}
            </div>
            <div class="flex items-center justify-center px-3 py-5 md:px-5">
              {#if row.academy}
                <span class="text-xl text-green-600" aria-label="Yes">✓</span>
              {:else}
                <span class="text-xl text-red-500" aria-label="No">×</span>
              {/if}
            </div>
            <div class="hidden px-5 py-5 text-sm leading-relaxed text-gray-600 md:block">{row.note}</div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="px-6 py-12 lg:px-12 lg:py-16">
    <div class="mx-auto max-w-[1120px]">
      <div class="grid grid-cols-1 lg:grid-cols-2 lg:divide-x lg:divide-gray-200">
        <!-- When docs are enough -->
        <div class="lg:pr-10">
          <div class="text-[11px] font-medium tracking-widest text-blue-700 uppercase">
            {$t('docs_vs_academy.when_docs_are_enough')}
          </div>
          <h2 class="mt-4 text-[clamp(1.6rem,2.6vw,2.2rem)] leading-[1.1] font-medium tracking-tight text-gray-950">
            {$t('docs_vs_academy.choose_documentation_when_the_task_is')}
          </h2>
          <p class="mt-5 text-sm leading-relaxed text-gray-500">
            {$t('docs_vs_academy.documentation_works_best_when_the_user')}
          </p>

          <div class="my-7 border-t border-gray-200"></div>

          <ul class="space-y-4">
            {#each docsUseCases as useCase}
              <li class="flex items-start gap-3 text-sm text-gray-700">
                <span
                  class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700"
                >
                  <Check size={12} strokeWidth={2.5} />
                </span>
                {useCase}
              </li>
            {/each}
          </ul>

          <div class="mt-8">
            <span
              class="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700"
            >
              <FileText size={13} strokeWidth={2} />
              {$t('docs_vs_academy.reference_retrieval')}
            </span>
          </div>
        </div>

        <!-- When an academy is better -->
        <div class="mt-12 lg:mt-0 lg:pl-10">
          <div class="text-[11px] font-medium tracking-widest text-emerald-700 uppercase">
            {$t('docs_vs_academy.when_an_academy_is_better')}
          </div>
          <h2 class="mt-4 text-[clamp(1.6rem,2.6vw,2.2rem)] leading-[1.1] font-medium tracking-tight text-gray-950">
            {$t('docs_vs_academy.choose_a_company_academy_when_capability')}
          </h2>
          <p class="mt-5 text-sm leading-relaxed text-gray-500">
            {$t('docs_vs_academy.an_academy_turns_scattered_knowledge_into')}
          </p>

          <div class="my-7 border-t border-gray-200"></div>

          <ul class="space-y-4">
            {#each academyUseCases as useCase}
              <li class="flex items-start gap-3 text-sm text-gray-700">
                <span
                  class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"
                >
                  <Check size={12} strokeWidth={2.5} />
                </span>
                {useCase}
              </li>
            {/each}
          </ul>

          <div class="mt-8">
            <span
              class="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700"
            >
              <GraduationCap size={13} strokeWidth={2} />
              {$t('docs_vs_academy.structured_learning')}
            </span>
          </div>
        </div>
      </div>
    </div>
  </section>

  <WorkflowSteps
    eyebrow={$t('docs_vs_academy.decision_framework')}
    title={$t('docs_vs_academy.ask_these_four_questions_before_creating')}
    description={$t('docs_vs_academy.the_wrong_format_creates_expensive_confusion')}
    steps={decisionSignals.map((signal, i) => ({
      title: signal.title,
      description: signal.description,
      label: `Question ${String(i + 1).padStart(2, '0')}`
    }))}
  />

  <section class="px-6 py-16 lg:px-12 lg:py-24">
    <div class="mx-auto grid max-w-[1120px] grid-cols-1 items-start gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
      <div>
        <div class="mb-3 text-xs font-medium tracking-widest text-blue-700 uppercase">
          {$t('docs_vs_academy.the_hybrid_model')}
        </div>
        <h2 class="text-[clamp(2rem,3vw,2.7rem)] leading-[1.15] font-medium tracking-tight text-gray-950">
          {$t('docs_vs_academy.the_strongest_teams_use_docs_and')}
        </h2>
        <p class="mt-5 text-base leading-relaxed text-gray-500">
          {$t('docs_vs_academy.treat_documentation_as_the_reference_layer')}
        </p>
      </div>

      <div class="space-y-4">
        {#each hybridModel as item, i}
          <BlurFade delay={0.08 * i} once>
            <div class="flex gap-4 rounded-2xl border border-gray-200 bg-white p-5">
              <div
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-700 text-sm font-medium text-white"
              >
                {i + 1}
              </div>
              <div>
                <h3 class="text-base font-medium text-gray-950">{item.title}</h3>
                <p class="mt-2 text-sm leading-relaxed text-gray-500">{item.description}</p>
              </div>
            </div>
          </BlurFade>
        {/each}
      </div>
    </div>
  </section>

  <PageSignupCTA
    header={$t('docs_vs_academy.classroomhub_can_host_your_company_academy')}
    subText={$t('docs_vs_academy.turn_your_docs_videos_policies_and')}
    btnLabel={$t('docs_vs_academy.book_a_demo')}
  />
</section>
