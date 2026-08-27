<script lang="ts">
  import { t } from '$lib/utils/functions/translations';
  import { onDestroy } from 'svelte';

  import { remainingSeconds } from './exam-autosave';

  /**
   * Displays the time left. It decides nothing: the server owns the clock, and this only
   * renders what the server said, corrected for how far this device's clock has drifted.
   *
   * Without that correction a phone running minutes fast shows a countdown that disagrees
   * with the server that will actually end the paper — and phones running minutes out are
   * common enough that a student would be told they had time when they did not.
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

  const label = $derived.by(() => {
    if (left === null) return $t('exam.sitting.no_time_limit');

    const minutes = Math.floor(left / 60);
    const seconds = left % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  });

  /** Under two minutes is when a student needs to notice without being panicked. */
  const urgent = $derived(left !== null && left <= 120);
</script>

<div
  class={[
    'ui:tabular-nums ui:rounded-md ui:px-3 ui:text-sm ui:font-semibold py-1.5',
    urgent ? 'bg-destructive/10 ui:text-destructive' : 'ui:bg-muted ui:text-foreground'
  ]}
  role="timer"
  aria-live={urgent ? 'assertive' : 'off'}
>
  {label}
</div>
