<script lang="ts">
  import ClockIcon from '@lucide/svelte/icons/clock';
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
  import { onDestroy } from 'svelte';

  import { t } from '$lib/utils/functions/translations';
  import { remainingSeconds } from './exam-autosave';

  /**
   * Displays the time left. It decides nothing: the server owns the clock, and this only
   * renders what the server said, corrected for how far this device's clock has drifted.
   *
   * Without that correction a phone running minutes fast shows a countdown that disagrees
   * with the server that will actually end the paper — and phones running minutes out are
   * common enough that a student would be told they had time when they did not.
   *
   * Three stages, not two. Colour alone carried the whole warning before, which says
   * nothing to a colour-blind candidate and arrives only two minutes from the end — too
   * late to change how you are spending the time you have left. Every stage now also
   * changes the icon and adds words.
   */
  let {
    expiresAt,
    clockOffsetMs = 0,
    onexpired
  }: {
    expiresAt: string | null;
    clockOffsetMs?: number;
    onexpired?: () => void;
  } = $props();

  /**
   * A tick counter rather than a stored remainder. Reading the props inside a `$derived`
   * is what makes the countdown follow an `expiresAt` that arrives *after* mount — which
   * is always, since the paper has no clock until the sitter starts it. Storing the
   * remainder in `$state` would capture the value at mount and then never move.
   */
  let tick = $state(0);
  let fired = false;

  const interval = setInterval(() => (tick += 1), 1_000);
  onDestroy(() => clearInterval(interval));

  const left = $derived.by(() => {
    void tick;
    return remainingSeconds(expiresAt, clockOffsetMs);
  });

  $effect(() => {
    if (left === 0 && !fired) {
      fired = true;
      onexpired?.();
    }
  });

  const NOTICE_SECONDS = 300;
  const URGENT_SECONDS = 60;

  type Stage = 'none' | 'plenty' | 'notice' | 'urgent';

  const stage = $derived.by<Stage>(() => {
    if (left === null) return 'none';
    if (left <= URGENT_SECONDS) return 'urgent';
    if (left <= NOTICE_SECONDS) return 'notice';

    return 'plenty';
  });

  const label = $derived.by(() => {
    if (left === null) return $t('exam.sitting.no_time_limit');

    const minutes = Math.floor(left / 60);
    const seconds = left % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  });

  /**
   * Announced when a stage is crossed, and only then.
   *
   * The countdown itself is `aria-live="off"`: a live region holding text that changes
   * every second re-announces every second, which under `assertive` interrupts whatever
   * the candidate was reading — once per second, for the length of the paper. Announcing
   * the two moments that matter tells them the same thing and lets them read.
   */
  let announcement = $state('');
  let announcedStage: Stage | null = null;

  $effect(() => {
    if (stage === announcedStage) return;

    const previous = announcedStage;
    announcedStage = stage;

    // Nothing to announce on the first render, or on a paper with no clock at all.
    if (previous === null || stage === 'none' || stage === 'plenty') return;

    announcement = stage === 'urgent' ? $t('exam.sitting.one_minute_left') : $t('exam.sitting.five_minutes_left');
  });
</script>

<div
  class={[
    'ui:tabular-nums ui:inline-flex ui:items-center ui:gap-1.5 ui:rounded-md ui:px-3 ui:py-1.5 ui:text-base ui:font-semibold ui:transition-colors',
    stage === 'urgent'
      ? 'ui:bg-destructive ui:text-white'
      : stage === 'notice'
        ? 'ui:bg-amber-100 ui:text-amber-900 ui:dark:bg-amber-950 ui:dark:text-amber-100'
        : 'ui:bg-muted ui:text-foreground'
  ]}
  role="timer"
  aria-live="off"
  aria-label={$t('exam.sitting.time_left', { time: label })}
>
  {#if stage === 'urgent'}
    <!--
      The icon changes as well as the colour. A candidate who cannot tell the red from the
      grey still sees a different shape, and everyone sees it move from a clock to a
      warning — which is the actual message.
    -->
    <TriangleAlertIcon size={16} aria-hidden="true" />
  {:else}
    <ClockIcon size={16} aria-hidden="true" />
  {/if}

  <span>{label}</span>
</div>

<!-- Off-screen, and written to only when a threshold is crossed. -->
<span class="ui:sr-only" role="status" aria-live="polite">{announcement}</span>
