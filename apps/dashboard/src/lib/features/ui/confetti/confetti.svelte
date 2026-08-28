<script>
  import { onDestroy, onMount } from 'svelte';
  import confetti from 'canvas-confetti';
  import { confettiStore } from './store';

  /**
   * The burst itself.
   *
   * The canvas covers the viewport and ignores the pointer. It used to be positioned
   * absolutely at 60% by 70% of whatever contained it, so on a scrolled page — or inside a
   * panel — the particles fell somewhere off screen and the celebration simply did not
   * appear. It was drawn at `z-index: 0` as well, which put it under most of the page.
   *
   * Motion is skipped for anybody who has asked their system for less of it.
   */
  let canvas = $state();
  let fire;
  let timers = [];

  const reducedMotion =
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  function burst() {
    if (!fire || reducedMotion?.matches) return;

    const duration = 4_000;
    const endsAt = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 };

    const timer = setInterval(() => {
      const left = endsAt - Date.now();

      if (left <= 0) {
        clearInterval(timer);
        timers = timers.filter((each) => each !== timer);

        return;
      }

      const particleCount = 50 * (left / duration);
      const from = (min, max) => Math.random() * (max - min) + min;

      fire({ ...defaults, particleCount, origin: { x: from(0.1, 0.3), y: Math.random() - 0.2 } });
      fire({ ...defaults, particleCount, origin: { x: from(0.7, 0.9), y: Math.random() - 0.2 } });
    }, 250);

    timers.push(timer);
  }

  onMount(() => {
    fire = confetti.create(canvas, { resize: true, useWorker: true });
  });

  onDestroy(() => {
    for (const timer of timers) clearInterval(timer);
    timers = [];
  });

  // Zero is the initial value, not a celebration; every increment after it is one.
  let seen = 0;

  $effect(() => {
    const fired = $confettiStore.fired;
    if (fired === seen) return;

    seen = fired;
    if (fired > 0) burst();
  });
</script>

<canvas bind:this={canvas} aria-hidden="true"></canvas>

<style>
  canvas {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 60;
  }
</style>
