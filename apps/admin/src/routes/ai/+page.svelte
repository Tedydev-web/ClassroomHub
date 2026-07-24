<script lang="ts">
  import type { GatewayHealth, GatewayQuota } from '$lib/types';
  import { gatewayStatus, quotaLevel } from '$lib/gateway';

  import { relativeTime } from '$lib/format';
  import { useAdmin } from '$lib/context';

  const { api } = useAdmin();

  let health = $state<GatewayHealth | null>(null);
  let quota = $state<GatewayQuota | null>(null);
  let loading = $state(true);
  let error = $state('');
  let acting = $state(false);
  let pauseReason = $state('');

  const gwState = $derived(health ? gatewayStatus(health) : null);
  const banner = $derived(
    {
      healthy: { label: 'Healthy', cls: 'bg-success-weak text-success' },
      cooling: { label: 'Cooling down', cls: 'bg-danger-weak text-danger' },
      down: { label: 'Unavailable', cls: 'bg-danger-weak text-danger' },
      paused: { label: 'Paused', cls: 'bg-surface-hover text-text' }
    }[gwState ?? 'down']
  );

  async function refresh() {
    loading = true;
    error = '';
    try {
      [health, quota] = await Promise.all([api.gatewayHealth(), api.gatewayQuota()]);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load gateway status';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    refresh();
  });

  // The API's ZGatewayPause requires reason length ≥ 3; mirror it so a too-short
  // reason is blocked here instead of round-tripping to a 400.
  const pauseReady = $derived(pauseReason.trim().length >= 3);

  async function pause() {
    if (!pauseReady || acting) return;
    acting = true;
    error = '';
    try {
      await api.gatewayPause(pauseReason.trim());
      pauseReason = '';
      await refresh();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to pause';
    } finally {
      acting = false;
    }
  }

  async function run(fn: () => Promise<unknown>) {
    acting = true;
    error = '';
    try {
      await fn();
      await refresh();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Action failed';
    } finally {
      acting = false;
    }
  }
</script>

<div class="mb-4 flex items-end justify-between gap-4">
  <div>
    <h1>AI Gateway</h1>
    <p class="text-muted mt-1 text-[13px]">Shared Codex gateway — platform-wide controls.</p>
  </div>
  <button class="btn btn-sm" onclick={refresh} disabled={loading}>Re-check</button>
</div>

{#if error}<p class="error-text mb-3" role="alert">{error}</p>{/if}

{#if loading && !health}
  <div class="card mb-4 p-5"><div class="skeleton h-6 w-40"></div></div>
{:else if health}
  <!-- Status + kill switch -->
  <div class="card mb-4 flex flex-wrap items-center gap-4 p-5">
    <span class="badge {banner.cls} h-7 px-3 text-[13px]">{banner.label}</span>
    <div class="text-muted flex-1 text-[13px]">
      Breaker: <span class="text-text">{health.circuitState}</span>
      {#if health.circuitResumeAfter}· resumes {relativeTime(health.circuitResumeAfter)}{/if}
      · {health.consecutiveFailures} consecutive failures
      {#if health.paused && health.pauseReason}<br />Paused: “{health.pauseReason}”{/if}
    </div>
    {#if health.paused}
      <button class="btn btn-primary" onclick={() => run(() => api.gatewayResume())} disabled={acting}>Resume</button>
    {:else}
      <form class="flex gap-2" onsubmit={(e) => (e.preventDefault(), pause())}>
        <input
          class="input w-[220px]"
          placeholder="Reason to pause…"
          minlength="3"
          bind:value={pauseReason}
          aria-label="Reason to pause the gateway"
        />
        <button class="btn btn-danger" type="submit" disabled={acting || !pauseReady}>Pause</button>
      </form>
    {/if}
    {#if health.circuitState === 'open'}
      <button class="btn" onclick={() => run(() => api.gatewayResetBreaker())} disabled={acting}>Reset breaker</button>
    {/if}
  </div>

  <div class="grid grid-cols-2 gap-4 max-[720px]:grid-cols-1">
    <!-- Health checks -->
    <section>
      <h2 class="mb-3">Health checks</h2>
      <div class="card divide-border divide-y">
        <div class="flex items-center justify-between p-4">
          <span class="text-[13px]">Reachable</span>
          <span class="badge {health.checks.reachable.ok ? 'badge-success' : 'badge-danger'}">
            {health.checks.reachable.ok ? 'OK' : 'Fail'}
          </span>
        </div>
        <div class="flex items-center justify-between p-4">
          <span class="text-[13px]">Can serve</span>
          {#if health.checks.canServe}
            <span class="badge {health.checks.canServe.ok ? 'badge-success' : 'badge-danger'}">
              {health.checks.canServe.ok ? 'OK' : 'Fail'}
            </span>
          {:else}
            <span class="badge badge-neutral">Skipped</span>
          {/if}
        </div>
        {#if !health.checks.reachable.ok && health.checks.reachable.detail}
          <p class="text-muted p-4 text-[12px]">{health.checks.reachable.detail}</p>
        {/if}
      </div>
    </section>

    <!-- Quota windows -->
    <section>
      <h2 class="mb-3">Quota windows</h2>
      <div class="card p-4">
        {#if quota && quota.windows.length > 0}
          {#each quota.windows as w (w.id)}
            {@const lvl = quotaLevel(w.percentUsed)}
            <div class="mb-4 last:mb-0">
              <div class="mb-1 flex items-center justify-between text-[12px]">
                <span class="text-muted">{w.durationMinutes}m window</span>
                <span class="tabular">{w.usedUnits.toLocaleString()} / {w.capUnits.toLocaleString()}</span>
              </div>
              <div class="bg-surface-hover h-2 overflow-hidden rounded-full">
                <div
                  class="h-full rounded-full {lvl === 'crit'
                    ? 'bg-danger'
                    : lvl === 'warn'
                      ? 'bg-[#d97706]'
                      : 'bg-success'}"
                  style="width: {Math.min(100, w.percentUsed)}%"
                ></div>
              </div>
            </div>
          {/each}
        {:else}
          <div class="empty">No quota windows configured.</div>
        {/if}
      </div>
    </section>
  </div>

  {#if health.unrecognizedModels.length > 0}
    <p class="text-muted mt-4 text-[12px]">
      Allowlisted but not advertised by the proxy: {health.unrecognizedModels.join(', ')}
    </p>
  {/if}
{/if}
