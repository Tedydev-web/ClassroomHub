<script lang="ts">
  import { t } from '$lib/utils/functions/translations';
  import { Button } from '@cio/ui/base/button';
  import { Badge } from '@cio/ui/base/badge';
  import * as Item from '@cio/ui/base/item';
  import * as Empty from '@cio/ui/base/empty';
  import * as DropdownMenu from '@cio/ui/base/dropdown-menu';
  import { Spinner } from '@cio/ui/base/spinner';
  import { IconButton } from '@cio/ui/custom/icon-button';
  import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';

  import { classroomhub } from '$lib/utils/services/api';
  import { snackbar } from '$features/ui/snackbar/store';

  /** One row as the list needs it; the loader hands these straight through. */
  type ExamRow = {
    id: string;
    title: string;
    slug: string;
    status: string;
    mode: string;
    workingSeconds: number | null;
    opensAt?: string | null;
    closesAt?: string | null;
    maxAttempts?: number | null;
    requiresName?: boolean;
    requiresClass?: boolean;
    requiresCandidateNumber?: boolean;
    /** How many people have sat it, and how much of that is still waiting on a human. */
    sat?: number;
    inProgress?: number;
    awaitingManual?: number;
  };

  /**
   * The exams of one course.
   *
   * Opening an exam is the moment its paper stops moving, so this is also where a teacher
   * is shown the paper's shape before the link goes out. That summary earns its place from
   * our own history: the `.docx` import once published forty questions with seventeen
   * answer keys missing, and nobody knew until students sat it.
   */
  let { courseId, exams: initialExams }: { courseId: string; exams: ExamRow[] } = $props();

  /**
   * The loader is the source; `refreshed` only holds what a button fetched since. Storing
   * the loader's value in plain state instead would capture it at mount, so navigating
   * away and back would render whatever was on screen the first time.
   */
  let refreshed = $state<ExamRow[] | null>(null);
  const exams = $derived(refreshed ?? initialExams);
  let busyId = $state<string | null>(null);
  let summary = $state<{
    examId: string;
    questionCount: number;
    questionsWithoutAnswerKey: Array<{ order: number; title: string }>;
  } | null>(null);

  async function refresh() {
    const response = await classroomhub.exam.course[':courseId'].$get({ param: { courseId } });
    const body = await response.json();
    if ('success' in body && body.success) refreshed = body.data;
  }

  /** Shown before opening, never as a gate. It reports; the teacher decides. */
  async function checkPaper(examId: string) {
    busyId = examId;

    try {
      const response = await classroomhub.exam[':examId'].summary.$get({ param: { examId } });
      const body = await response.json();

      if ('success' in body && body.success) {
        summary = { examId, ...body.data };
      }
    } finally {
      busyId = null;
    }
  }

  async function open(examId: string) {
    busyId = examId;

    try {
      const response = await classroomhub.exam[':examId'].open.$post({ param: { examId } });

      if (response.ok) {
        snackbar.success($t('exam.manage.opened_notice'));
        await refresh();
      } else {
        const body = await response.json();
        snackbar.error('error' in body ? String(body.error) : $t('exam.manage.open_failed'));
      }
    } finally {
      busyId = null;
    }
  }

  async function close(examId: string) {
    busyId = examId;

    try {
      await classroomhub.exam[':examId'].close.$post({ param: { examId } });
      snackbar.success($t('exam.manage.closed_notice'));
      await refresh();
    } finally {
      busyId = null;
    }
  }

  async function copyLink(slug: string) {
    await navigator.clipboard.writeText(`${window.location.origin}/exam/${slug}`);
    snackbar.success($t('exam.manage.link_copied'));
  }

  const STATUS_LABEL: Record<string, string> = {
    draft: $t('exam.manage.draft'),
    open: $t('exam.manage.open'),
    closed: $t('exam.manage.closed')
  };

  /**
   * Status carries the accent, and nothing else on the row does.
   *
   * An open exam is the only state a teacher can still act on from here, so it is the only
   * one that gets a solid badge; a draft is outlined because it is waiting on them, and a
   * closed one recedes. Spending colour on every row would leave the eye nowhere to land.
   */
  const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
    draft: 'outline',
    open: 'default',
    closed: 'secondary'
  };

  const dateFormat = new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });

  function when(value: string | null | undefined): string | null {
    if (!value) return null;
    const parsed = new Date(value);

    return Number.isNaN(parsed.getTime()) ? null : dateFormat.format(parsed);
  }

  /** The sitting window, in whichever of its three shapes this exam actually has. */
  function windowLabel(exam: ExamRow): string | null {
    const from = when(exam.opensAt);
    const until = when(exam.closesAt);
    if (from && until) return $t('exam.manage.window_between', { from, until });
    if (from) return $t('exam.manage.window_from', { from });
    if (until) return $t('exam.manage.window_until', { until });

    return null;
  }

  /** What a sitter is asked for before they start, listed only when something is asked. */
  function askedFor(exam: ExamRow): string | null {
    const fields = [
      exam.requiresName ? $t('exam.entry.full_name') : null,
      exam.requiresClass ? $t('exam.entry.class_name') : null,
      exam.requiresCandidateNumber ? $t('exam.entry.candidate_number') : null
    ].filter(Boolean);

    return fields.length > 0 ? $t('exam.manage.asks_for', { fields: fields.join(', ') }) : null;
  }

  /**
   * The facts about how an exam is configured, as short chips.
   *
   * They sit below the actions rather than beside the title because a teacher scanning the
   * list is looking for state and participation first; the configuration is what they read
   * once they have found the row they came for.
   */
  function settingChips(exam: ExamRow): string[] {
    const chips = [
      exam.mode === 'public' ? $t('exam.manage.public_mode') : $t('exam.manage.private_mode'),
      exam.workingSeconds
        ? $t('exam.manage.minutes', { minutes: String(Math.round(exam.workingSeconds / 60)) })
        : $t('exam.manage.unlimited_time')
    ];

    const window = windowLabel(exam);
    if (window) chips.push(window);
    if (exam.maxAttempts && exam.maxAttempts > 1) {
      chips.push($t('exam.manage.attempts_allowed', { count: String(exam.maxAttempts) }));
    }

    const asked = askedFor(exam);
    if (asked) chips.push(asked);

    return chips;
  }
</script>

<div class="ui:space-y-4">
  {#if exams.length === 0}
    <!--
      The empty state carries the explanation that used to sit as a permanent footnote
      under a populated list, where nobody reading it needed it. Somebody with no exams is
      exactly who has to be told what an exam is and how it differs from an exercise.
    -->
    <Empty.Root class="ui:border-border ui:rounded-lg ui:border ui:border-dashed">
      <Empty.Header>
        <Empty.Title>{$t('exam.manage.empty_title')}</Empty.Title>
        <Empty.Description>{$t('exam.manage.separation_note')}</Empty.Description>
      </Empty.Header>
      <Empty.Content>
        <Button href={`/courses/${courseId}/exams/new`}>{$t('exam.manage.create')}</Button>
      </Empty.Content>
    </Empty.Root>
  {:else}
    <Item.Group class="ui:space-y-3">
      {#each exams as exam (exam.id)}
        {@const sat = exam.sat ?? 0}
        {@const sitting = exam.inProgress ?? 0}
        {@const awaiting = exam.awaitingManual ?? 0}
        {@const checking = busyId === exam.id}
        <Item.Root variant="outline" class="ui:rounded-lg ui:flex-col ui:items-stretch ui:gap-3">
          <div class="ui:flex ui:flex-wrap ui:items-start ui:justify-between ui:gap-3">
            <Item.Content class="ui:min-w-0 ui:gap-1">
              <div class="ui:flex ui:min-w-0 ui:flex-wrap ui:items-center ui:gap-2">
                <Badge variant={STATUS_VARIANT[exam.status] ?? 'secondary'}>
                  {STATUS_LABEL[exam.status] ?? exam.status}
                </Badge>
                <Item.Title class="ui:min-w-0 ui:truncate ui:text-sm ui:font-semibold">
                  {exam.title}
                </Item.Title>
              </div>

              <!--
                Participation, in the order a teacher asks for it: has anyone sat this, is
                anyone sitting it right now, and is any of it waiting on me. The last one is
                the only line that can require action, so it is the only one that takes a
                colour.
              -->
              <Item.Description class="ui:flex ui:flex-wrap ui:items-center ui:gap-x-3 ui:gap-y-1 ui:text-xs">
                {#if sat === 0}
                  <span class="ui:text-muted-foreground">{$t('exam.manage.no_one_yet')}</span>
                {:else}
                  <span class="ui:text-foreground ui:font-medium ui:tabular-nums">
                    {$t('exam.manage.sat_count')}: {sat}
                  </span>
                {/if}
                {#if sitting > 0}
                  <span class="ui:text-muted-foreground ui:tabular-nums">
                    {$t('exam.manage.sitting_now', { count: String(sitting) })}
                  </span>
                {/if}
                {#if awaiting > 0}
                  <span class="ui:font-medium ui:tabular-nums ui:text-amber-600 ui:dark:text-amber-400">
                    {$t('exam.manage.awaiting_marking', { count: String(awaiting) })}
                  </span>
                {/if}
              </Item.Description>
            </Item.Content>

            <!--
              One solid action per state — the thing that state makes possible — and the
              rest behind a menu. Four buttons of equal weight made the row read as a
              toolbar rather than as an exam.
            -->
            <Item.Actions class="ui:shrink-0 ui:gap-2">
              {#if exam.status === 'draft'}
                <Button size="sm" disabled={checking} onclick={() => open(exam.id)}>
                  {$t('exam.manage.open_exam')}
                </Button>
              {:else if exam.status === 'open'}
                <Button size="sm" variant="outline" onclick={() => copyLink(exam.slug)}>
                  {$t('exam.manage.copy_link')}
                </Button>
              {/if}

              <Button size="sm" variant="ghost" href={`/courses/${courseId}/exams/${exam.id}/results`}>
                {$t('exam.manage.results')}
              </Button>

              <DropdownMenu.Root>
                <DropdownMenu.Trigger class="ui:inline-flex ui:items-center ui:justify-center">
                  <IconButton aria-label={$t('exam.manage.more_actions')}>
                    <EllipsisVerticalIcon size={16} />
                  </IconButton>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content align="end">
                  <DropdownMenu.Item disabled={checking} onclick={() => checkPaper(exam.id)}>
                    {$t('exam.manage.check_paper')}
                  </DropdownMenu.Item>
                  {#if exam.status === 'open'}
                    <DropdownMenu.Item disabled={checking} onclick={() => close(exam.id)}>
                      {$t('exam.manage.close_exam')}
                    </DropdownMenu.Item>
                  {/if}
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </Item.Actions>
          </div>

          <div class="ui:text-muted-foreground ui:flex ui:flex-wrap ui:items-center ui:gap-x-3 ui:gap-y-1 ui:text-xs">
            {#each settingChips(exam) as chip, position (position)}
              {#if position > 0}<span aria-hidden="true">·</span>{/if}
              <span>{chip}</span>
            {/each}
          </div>

          {#if checking}
            <p class="ui:text-muted-foreground ui:flex ui:items-center ui:gap-2 ui:text-xs">
              <Spinner class="ui:size-3" />
              {$t('exam.manage.checking_paper')}
            </p>
          {:else if summary && summary.examId === exam.id}
            <!--
              The paper check, kept on the row that asked for it. A missing answer key is
              the one thing here that must stop a teacher before they open the exam, so it
              reads as a warning rather than as another fact.
            -->
            {@const missing = summary.questionsWithoutAnswerKey}
            <div
              class={missing.length > 0
                ? 'ui:rounded-md ui:border ui:p-3 ui:text-xs border-amber-500/40 bg-amber-500/10'
                : 'ui:bg-muted ui:rounded-md ui:p-3 ui:text-xs'}
            >
              <p class="ui:font-medium">
                {$t('exam.manage.question_count', { count: String(summary.questionCount) })}
              </p>
              {#if missing.length > 0}
                <p class="ui:mt-1 ui:font-medium ui:dark:text-amber-300 text-amber-700">
                  {$t('exam.manage.missing_keys', {
                    count: String(missing.length),
                    questions: missing.map((question) => question.order).join(', ')
                  })}
                </p>
                <p class="ui:text-muted-foreground ui:mt-1">{$t('exam.manage.missing_keys_note')}</p>
              {:else}
                <p class="ui:text-muted-foreground ui:mt-1">{$t('exam.manage.all_keys_present')}</p>
              {/if}
            </div>
          {/if}
        </Item.Root>
      {/each}
    </Item.Group>
  {/if}
</div>
