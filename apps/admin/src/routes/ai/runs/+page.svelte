<script lang="ts">
  import type { GatewayRun } from '$lib/types';
  import { CANCELLABLE_STATUSES, RUN_FILTERS, runStatusBadge } from '$lib/gateway';

  import { relativeTime } from '$lib/format';
  import { useAdmin } from '$lib/context';

  const { api } = useAdmin();

  // Default view: the in-flight runs an operator would act on. Filter values are
  // comma-lists the API validator accepts verbatim — see RUN_FILTERS in gateway.ts,
  // which gateway.test.ts pins to the API's accepted status set.
  let filter = $state('queued,running');
  let runs = $state<GatewayRun[]>([]);
  let loading = $state(true);
  let error = $state('');
  let cancelling = $state<string | null>(null);

  async function refresh() {
    loading = true;
    error = '';
    try {
      runs = await api.gatewayRuns(filter || undefined);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load runs';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    // Re-runs whenever `filter` changes.
    filter;
    refresh();
  });

  async function cancel(run: GatewayRun) {
    if (cancelling) return;
    if (!confirm(`Force-cancel run ${run.id}? The org's in-flight work is dropped.`)) return;
    cancelling = run.id;
    error = '';
    try {
      await api.cancelGatewayRun(run.id);
      await refresh();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to cancel run';
    } finally {
      cancelling = null;
    }
  }
</script>

<div class="mb-4 flex items-end justify-between gap-4">
  <div>
    <h1>Gateway — runs</h1>
    <p class="text-muted mt-1 text-[13px]">Live and recent gateway runs across every org.</p>
  </div>
  <button class="btn btn-sm" onclick={refresh} disabled={loading}>Refresh</button>
</div>

<div class="mb-4 flex gap-1" role="tablist" aria-label="Filter runs by status">
  {#each RUN_FILTERS as f (f.value)}
    <button
      class="btn btn-sm {filter === f.value ? 'btn-primary' : 'btn-ghost'}"
      role="tab"
      aria-selected={filter === f.value}
      onclick={() => (filter = f.value)}
    >
      {f.label}
    </button>
  {/each}
</div>

{#if error}<p class="error-text mb-3" role="alert">{error}</p>{/if}

<div class="table-wrap">
  <table class="data">
    <thead>
      <tr>
        <th>Run</th>
        <th>Organization</th>
        <th>Status</th>
        <th>Phase</th>
        <th class="num">Rounds</th>
        <th>Updated</th>
        <th class="w-px"></th>
      </tr>
    </thead>
    <tbody>
      {#if loading}
        {#each Array(5) as _, i (i)}
          <tr>
            <td><div class="skeleton h-3 w-32"></div></td>
            <td><div class="skeleton h-3 w-28"></div></td>
            <td><div class="skeleton h-3 w-16"></div></td>
            <td><div class="skeleton h-3 w-20"></div></td>
            <td class="num"><div class="skeleton ml-auto h-3 w-6"></div></td>
            <td><div class="skeleton h-3 w-20"></div></td>
            <td></td>
          </tr>
        {/each}
      {:else if runs.length > 0}
        {#each runs as run (run.id)}
          <tr>
            <td class="tabular text-[12px]">{run.id}</td>
            <td class="tabular text-[12px]">{run.orgId}</td>
            <td><span class="badge {runStatusBadge(run.status)}">{run.status}</span></td>
            <td class="text-muted text-[13px]">{run.phase ?? '—'}</td>
            <td class="num">{run.totalRounds}</td>
            <td class="text-muted text-[13px]">{relativeTime(run.updatedAt)}</td>
            <td class="w-px text-right">
              {#if CANCELLABLE_STATUSES.has(run.status)}
                <button class="btn btn-sm btn-danger" onclick={() => cancel(run)} disabled={cancelling === run.id}>
                  {cancelling === run.id ? 'Cancelling…' : 'Cancel'}
                </button>
              {/if}
            </td>
          </tr>
        {/each}
      {:else}
        <tr>
          <td colspan="7"
            ><div class="empty">
              No {RUN_FILTERS.find((f) => f.value === filter)?.label.toLowerCase() ?? ''} runs.
            </div></td
          >
        </tr>
      {/if}
    </tbody>
  </table>
</div>
