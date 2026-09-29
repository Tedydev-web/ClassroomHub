<script lang="ts">
  import type { HealthCheck, HealthGroup, HealthStatus, SystemHealth, TestEmailResult } from '$lib/types';
  import { relativeTime } from '$lib/format';
  import { useAdmin } from '$lib/context';

  const { api } = useAdmin();

  let health = $state<SystemHealth | null>(null);
  let loading = $state(true);
  let error = $state('');
  let sendingEmail = $state(false);
  let emailResult = $state<TestEmailResult | null>(null);

  const GROUPS: { id: HealthGroup; label: string }[] = [
    { id: 'infrastructure', label: 'Infrastructure' },
    { id: 'storage', label: 'Storage' },
    { id: 'email', label: 'Email' },
    { id: 'ai', label: 'AI' },
    { id: 'integrations', label: 'Integrations & tokens' },
    { id: 'endpoints', label: 'Public endpoints & TLS' }
  ];

  const STATUS: Record<HealthStatus, { label: string; cls: string }> = {
    ok: { label: 'OK', cls: 'badge-success' },
    warn: { label: 'Warning', cls: 'badge-warning' },
    fail: { label: 'Failing', cls: 'badge-danger' },
    unconfigured: { label: 'Not configured', cls: 'badge-neutral' }
  };

  const BANNER: Record<'ok' | 'warn' | 'fail', { label: string; cls: string }> = {
    ok: { label: 'All systems operational', cls: 'bg-success-weak text-success' },
    warn: { label: 'Degraded', cls: 'bg-[#d97706]/15 text-[#b45309] dark:text-[#f59e0b]' },
    fail: { label: 'Failing', cls: 'bg-danger-weak text-danger' }
  };

  function checksIn(group: HealthGroup): HealthCheck[] {
    return health?.live.checks.filter((check) => check.group === group) ?? [];
  }

  /** Failures only the jobs worker sees: a key missing from its environment breaks background work. */
  const jobsOnlyFailures = $derived.by(() => {
    if (!health?.scheduled) return [];
    const liveFailing = new Set(health.live.checks.filter((c) => c.status === 'fail').map((c) => c.id));

    return health.scheduled.checks.filter((check) => check.status === 'fail' && !liveFailing.has(check.id));
  });

  async function refresh() {
    loading = true;
    error = '';
    try {
      health = await api.systemHealth();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to run health checks';
    } finally {
      loading = false;
    }
  }

  async function sendTestEmail() {
    sendingEmail = true;
    emailResult = null;
    try {
      emailResult = await api.sendTestEmail();
    } catch (e) {
      emailResult = { accepted: false, detail: e instanceof Error ? e.message : 'Request failed' };
    } finally {
      sendingEmail = false;
    }
  }

  $effect(() => {
    refresh();
  });
</script>

<div class="mb-4 flex items-end justify-between gap-4">
  <div>
    <h1>System health</h1>
    <p class="text-muted mt-1 text-[13px]">
      Live checks of every production dependency. Secrets are never shown — only whether they work.
    </p>
  </div>
  <div class="flex gap-2">
    <button class="btn btn-sm" onclick={sendTestEmail} disabled={sendingEmail}>
      {sendingEmail ? 'Sending…' : 'Send test email'}
    </button>
    <button class="btn btn-sm btn-primary" onclick={refresh} disabled={loading}>
      {loading ? 'Checking…' : 'Re-check'}
    </button>
  </div>
</div>

{#if error}<p class="error-text mb-3" role="alert">{error}</p>{/if}

{#if emailResult}
  <div class="card mb-4 flex items-center gap-3 p-4 text-[13px]">
    <span class="badge {emailResult.accepted ? 'badge-success' : 'badge-danger'}">
      {emailResult.accepted ? 'Accepted' : 'Failed'}
    </span>
    <span class="text-muted">
      {emailResult.accepted ? 'Test email sent to the operator inbox — ' : ''}{emailResult.detail}
    </span>
  </div>
{/if}

{#if loading && !health}
  <div class="card mb-4 p-5"><div class="skeleton h-6 w-48"></div></div>
{:else if health}
  {@const banner = BANNER[health.live.status]}
  <div class="card mb-4 flex flex-wrap items-center gap-4 p-5">
    <span class="badge {banner.cls} h-7 px-3 text-[13px]">{banner.label}</span>
    <div class="text-muted flex-1 text-[13px]">
      Checked {relativeTime(health.live.checkedAt)} in {health.live.durationMs} ms (API process).
      {#if health.scheduled}
        Scheduled scan (jobs worker): {BANNER[health.scheduled.status].label.toLowerCase()},
        {relativeTime(health.scheduled.checkedAt)}.
      {:else}
        No scheduled scan recorded yet.
      {/if}
    </div>
  </div>

  {#if jobsOnlyFailures.length > 0}
    <div class="card border-danger mb-4 p-4">
      <h2 class="mb-2">Failing only in the jobs worker</h2>
      <ul class="text-[13px]">
        {#each jobsOnlyFailures as check (check.id)}
          <li><strong>{check.label}</strong> — <span class="text-muted">{check.detail}</span></li>
        {/each}
      </ul>
    </div>
  {/if}

  <div class="grid grid-cols-2 gap-4 max-[900px]:grid-cols-1">
    {#each GROUPS as group (group.id)}
      {@const checks = checksIn(group.id)}
      {#if checks.length > 0}
        <section>
          <h2 class="mb-3">{group.label}</h2>
          <div class="card divide-border divide-y">
            {#each checks as check (check.id)}
              <div class="flex items-start justify-between gap-3 p-4">
                <div class="min-w-0">
                  <div class="text-[13px] font-medium">{check.label}</div>
                  <div class="text-muted mt-0.5 text-[12px] break-words">{check.detail}</div>
                </div>
                <div class="flex shrink-0 flex-col items-end gap-1">
                  <span class="badge {STATUS[check.status].cls}">{STATUS[check.status].label}</span>
                  <span class="text-muted tabular text-[11px]">{check.latencyMs} ms</span>
                </div>
              </div>
            {/each}
          </div>
        </section>
      {/if}
    {/each}
  </div>
{/if}
