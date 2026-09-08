<script lang="ts">
  import { PRODUCT_URLS, SALES_EMAIL } from '@cio/utils/constants';
  import { CodeBlock, HeroSubtitle, McpServerSection, PageHeader, PageSignupCTA } from '$lib/components';
  import { t } from '$lib/i18n';
  import { Badge } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import Code2 from '@lucide/svelte/icons/code-2';

  const apiCurl = [
    '<span class="text-slate-500"># Enroll a learner in a course</span>',
    `<span class="text-pink-400">curl</span> <span class="text-emerald-300">"${PRODUCT_URLS.api}/v1/enrollments"</span> \\`,
    '  <span class="text-sky-300">-H</span> <span class="text-emerald-300">"Authorization: Bearer $CIO_API_KEY"</span> \\',
    '  <span class="text-sky-300">-H</span> <span class="text-emerald-300">"Content-Type: application/json"</span> \\',
    '  <span class="text-sky-300">-d</span> <span class="text-emerald-300">\'{ "courseId": "crs_…", "userId": "usr_…" }\'</span>'
  ];

  const webhookSample = [
    '<span class="text-slate-500">// POST https://yourapp.com/webhooks/cio</span>',
    '<span class="text-slate-500">{</span>',
    '  <span class="text-sky-300">"event"</span><span class="text-slate-500">:</span> <span class="text-emerald-300">"certificate.issued"</span><span class="text-slate-500">,</span>',
    '  <span class="text-sky-300">"orgId"</span><span class="text-slate-500">:</span> <span class="text-emerald-300">"org_acme"</span><span class="text-slate-500">,</span>',
    '  <span class="text-sky-300">"data"</span><span class="text-slate-500">: {</span>',
    '    <span class="text-sky-300">"learnerId"</span><span class="text-slate-500">:</span> <span class="text-emerald-300">"usr_…"</span><span class="text-slate-500">,</span>',
    '    <span class="text-sky-300">"courseId"</span><span class="text-slate-500">:</span> <span class="text-emerald-300">"crs_…"</span><span class="text-slate-500">,</span>',
    '    <span class="text-sky-300">"certificateUrl"</span><span class="text-slate-500">:</span> <span class="text-emerald-300">"https://learn.acme.com/v/CIO-…"</span>',
    '  <span class="text-slate-500">},</span>',
    '  <span class="text-sky-300">"createdAt"</span><span class="text-slate-500">:</span> <span class="text-emerald-300">"2026-05-15T12:04:18Z"</span>',
    '<span class="text-slate-500">}</span>'
  ];

  const events = [
    'user.created',
    'enrollment.created',
    'enrollment.completed',
    'lesson.completed',
    'exercise.submitted',
    'exercise.graded',
    'certificate.issued',
    'cohort.completed',
    'course.published',
    'course.unpublished'
  ];
</script>

<section class="bg-white">
  <PageHeader className="px-6 lg:px-12">
    <div class="mx-auto max-w-[1100px]">
      <Badge variant="outline" class="mb-6 gap-2! bg-white px-3.5! py-1.5!">
        <Code2 size={14} class="text-blue-700" />
        {$t('dev.badge')}
      </Badge>
      <h1 class="max-w-[820px] text-[clamp(2rem,3.4vw,2.8rem)] leading-[1.1] font-medium tracking-tight text-gray-950">
        {$t('dev.heading_lead')}
        <em class="text-blue-700 not-italic">{$t('dev.heading_accent')}</em>
      </h1>
      <HeroSubtitle>
        {$t('dev.subhead')}
      </HeroSubtitle>
      <div class="mt-8 flex flex-wrap items-center gap-3">
        <Button href="mailto:{SALES_EMAIL}?subject=ClassroomHub API access">{$t('dev.request_access')}</Button>
        <Button href="/pricing" variant="outline">{$t('dev.see_pricing')}</Button>
      </div>
    </div>
  </PageHeader>

  <!-- REST API -->
  <section class="px-6 py-12 lg:px-12 lg:py-16">
    <div class="mx-auto grid max-w-[1100px] grid-cols-1 items-center gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-20">
      <div>
        <div class="mb-2 text-xs font-medium tracking-widest text-blue-700 uppercase">REST API</div>
        <h2 class="text-[clamp(1.75rem,2.6vw,2.2rem)] leading-[1.15] font-medium tracking-tight">
          {$t('dev.api_heading')}
        </h2>
        <p class="mt-5 text-base leading-relaxed text-gray-500">
          {$t('dev.api_body')}
        </p>

        <ul class="mt-6 space-y-3 text-sm text-gray-700">
          <li class="flex items-start gap-2">
            <span class="mt-0.5 text-blue-700">→</span>
            {$t('dev.api_point_objects')}
          </li>
          <li class="flex items-start gap-2">
            <span class="mt-0.5 text-blue-700">→</span>
            {$t('dev.api_point_keys')}
          </li>
          <li class="flex items-start gap-2">
            <span class="mt-0.5 text-blue-700">→</span>
            {$t('dev.api_point_pagination')}
          </li>
          <li class="flex items-start gap-2">
            <span class="mt-0.5 text-blue-700">→</span>
            {$t('dev.api_point_versioning')}
          </li>
        </ul>
      </div>
      <CodeBlock
        fileName="enrol-a-learner.sh"
        lang="bash"
        codeLines={apiCurl}
        statusBar="POST · application/json · authenticated"
      />
    </div>
  </section>

  <!-- Webhooks -->
  <section class="bg-gray-50 px-6 py-12 lg:px-12 lg:py-16">
    <div class="mx-auto grid max-w-[1100px] grid-cols-1 items-center gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-20">
      <CodeBlock
        fileName="webhook-payload.json"
        lang="JSON"
        codeLines={webhookSample}
        statusBar="signed with HMAC-SHA256 · retries up to 24h"
      />
      <div>
        <div class="mb-2 text-xs font-medium tracking-widest text-blue-700 uppercase">Webhooks</div>
        <h2 class="text-[clamp(1.75rem,2.6vw,2.2rem)] leading-[1.15] font-medium tracking-tight">
          {$t('dev.webhooks_heading')}
        </h2>
        <p class="mt-5 text-base leading-relaxed text-gray-500">
          {$t('dev.webhooks_body')}
        </p>

        <div class="mt-6 flex flex-wrap gap-2">
          {#each events as event}
            <span class="rounded-full border border-gray-200 bg-white px-3 py-1 font-mono text-xs text-blue-700">
              {event}
            </span>
          {/each}
        </div>
      </div>
    </div>
  </section>

  <McpServerSection />

  <!-- Stack -->
  <section class="px-6 py-12 lg:px-12 lg:py-16">
    <div class="mx-auto grid max-w-[1100px] grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-20">
      <div>
        <div class="mb-2 text-xs font-medium tracking-widest text-blue-700 uppercase">{$t('dev.stack_eyebrow')}</div>
        <h2 class="text-[clamp(1.75rem,2.6vw,2.2rem)] leading-[1.15] font-medium tracking-tight">
          {$t('dev.stack_heading')}
        </h2>
        <p class="mt-5 text-base leading-relaxed text-gray-500">
          {$t('dev.stack_body')}
        </p>
      </div>

      <div class="rounded-2xl border border-gray-200 bg-gray-50 p-6">
        <p class="text-xs font-medium tracking-widest text-gray-500 uppercase">{$t('dev.stack_label')}</p>
        <ul class="mt-4 space-y-3 text-sm text-gray-700">
          <li class="flex items-start gap-3">
            <span
              class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-blue-50 text-[10px] font-medium text-blue-700"
              >API</span
            >
            {$t('dev.stack_api')}
          </li>
          <li class="flex items-start gap-3">
            <span
              class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-blue-50 text-[10px] font-medium text-blue-700"
              >UI</span
            >
            {$t('dev.stack_ui')}
          </li>
          <li class="flex items-start gap-3">
            <span
              class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-blue-50 text-[10px] font-medium text-blue-700"
              >AI</span
            >
            {$t('dev.stack_ai')}
          </li>
          <li class="flex items-start gap-3">
            <span
              class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-blue-50 text-[10px] font-medium text-blue-700"
              >MCP</span
            >
            {$t('dev.stack_mcp')} <span class="font-mono text-xs">@tedydev/classroom-mcp</span>
          </li>
        </ul>
      </div>
    </div>
  </section>

  <PageSignupCTA header={$t('dev.cta_header')} subText={$t('dev.cta_subtext')} btnLabel={$t('dev.request_access')} />
</section>
