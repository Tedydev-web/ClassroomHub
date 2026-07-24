<script lang="ts">
  import type { GatewayOrgs } from '$lib/types';

  import { useAdmin } from '$lib/context';

  const { api } = useAdmin();

  let data = $state<GatewayOrgs | null>(null);
  let loading = $state(true);
  let error = $state('');
  let saving = $state<string | null>(null);
  let weightInputs = $state<Record<string, string>>({});
  /** orgId currently toggling its AI tutor, tracked separately from `saving` (policy save) so the two actions don't disable each other. */
  let togglingTutor = $state<string | null>(null);

  async function refresh() {
    loading = true;
    error = '';
    try {
      data = await api.gatewayOrgs();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load org policies';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    refresh();
  });

  async function save(orgId: string, values: Record<string, unknown>) {
    saving = orgId;
    error = '';
    try {
      await api.updateGatewayOrg(orgId, values);
      await refresh();
      delete weightInputs[orgId];
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to update policy';
    } finally {
      saving = null;
    }
  }

  function setWeight(orgId: string) {
    // ZGatewayOrgPolicyPatch caps priorityWeight at 1..100; mirror it so an
    // out-of-range value is blocked here instead of round-tripping to a 400.
    const w = Number(weightInputs[orgId]);
    if (!Number.isInteger(w) || w < 1 || w > 100) return;
    save(orgId, { priorityWeight: w });
  }

  async function toggleTutor(orgId: string, currentlyEnabled: boolean) {
    togglingTutor = orgId;
    error = '';
    try {
      await api.setOrgTutorEnabled(orgId, !currentlyEnabled);
      await refresh();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to update AI tutor';
    } finally {
      togglingTutor = null;
    }
  }
</script>

<div class="mb-4 flex items-end justify-between gap-4">
  <div>
    <h1>Gateway — organizations</h1>
    <p class="text-muted mt-1 text-[13px]">
      Per-org priority and limits. A missing row means the org runs on defaults.
    </p>
  </div>
  <button class="btn btn-sm" onclick={refresh} disabled={loading}>Refresh</button>
</div>

{#if error}<p class="error-text mb-3" role="alert">{error}</p>{/if}

<div class="table-wrap">
  <table class="data">
    <thead>
      <tr>
        <th>Organization</th>
        <th class="num">Consumed</th>
        <th class="num">Priority</th>
        <th class="num">Active</th>
        <th class="num">Queued</th>
        <th>Status</th>
        <th>AI Tutor</th>
        <th class="w-px"></th>
      </tr>
    </thead>
    <tbody>
      {#if loading}
        {#each Array(4) as _, i (i)}
          <tr>
            <td><div class="skeleton h-3 w-40"></div></td>
            <td class="num"><div class="skeleton ml-auto h-3 w-12"></div></td>
            <td class="num"><div class="skeleton ml-auto h-3 w-8"></div></td>
            <td class="num"></td><td class="num"></td><td></td><td></td><td></td>
          </tr>
        {/each}
      {:else if data && (data.policies.length > 0 || data.consumptionOnly.length > 0)}
        {#each data.policies as p (p.orgId)}
          <tr>
            <td class="tabular text-[12px]">{p.orgId}</td>
            <td class="num">{p.consumedUnits.toLocaleString()}</td>
            <td class="num">
              <form class="flex justify-end gap-1" onsubmit={(e) => (e.preventDefault(), setWeight(p.orgId))}>
                <input
                  class="input tabular h-[26px] w-[56px] px-1 text-right text-[12px]"
                  type="number"
                  min="1"
                  max="100"
                  value={weightInputs[p.orgId] ?? String(p.priorityWeight)}
                  oninput={(e) => (weightInputs[p.orgId] = e.currentTarget.value)}
                  aria-label={`Priority weight for ${p.orgId}`}
                />
              </form>
            </td>
            <td class="num text-muted">{p.maxActiveRuns ?? '∞'}</td>
            <td class="num text-muted">{p.maxQueuedRuns ?? '∞'}</td>
            <td>
              {#if p.isBlocked}<span class="badge badge-danger">Blocked</span>
              {:else}<span class="badge badge-success">Active</span>{/if}
            </td>
            <td>
              <span class="badge {p.tutorEnabled ? 'badge-success' : 'badge-neutral'}">
                {p.tutorEnabled ? 'On' : 'Off'}
              </span>
            </td>
            <td class="w-px">
              <div class="flex justify-end gap-2">
                <button
                  class="btn btn-sm"
                  onclick={() => setWeight(p.orgId)}
                  disabled={saving === p.orgId || !weightInputs[p.orgId]}
                >
                  Save
                </button>
                {#if p.isBlocked}
                  <button
                    class="btn btn-sm"
                    onclick={() => save(p.orgId, { isBlocked: false, blockReason: null })}
                    disabled={saving === p.orgId}
                  >
                    Unblock
                  </button>
                {:else}
                  <button
                    class="btn btn-sm btn-danger"
                    onclick={() => save(p.orgId, { isBlocked: true, blockReason: 'Blocked from admin panel' })}
                    disabled={saving === p.orgId}
                  >
                    Block
                  </button>
                {/if}
                <button
                  class="btn btn-sm"
                  onclick={() => toggleTutor(p.orgId, p.tutorEnabled)}
                  disabled={togglingTutor === p.orgId}
                >
                  {p.tutorEnabled ? 'Disable tutor' : 'Enable tutor'}
                </button>
              </div>
            </td>
          </tr>
        {/each}
        {#each data.consumptionOnly as c (c.orgId)}
          <tr class="text-muted">
            <td class="tabular text-[12px]">{c.orgId}</td>
            <td class="num">{c.units.toLocaleString()}</td>
            <td class="num" colspan="4"><span class="text-[12px]">running on defaults</span></td>
            <td>
              <span class="badge {c.tutorEnabled ? 'badge-success' : 'badge-neutral'}">
                {c.tutorEnabled ? 'On' : 'Off'}
              </span>
            </td>
            <td class="w-px">
              <button
                class="btn btn-sm"
                onclick={() => toggleTutor(c.orgId, c.tutorEnabled)}
                disabled={togglingTutor === c.orgId}
              >
                {c.tutorEnabled ? 'Disable tutor' : 'Enable tutor'}
              </button>
            </td>
          </tr>
        {/each}
      {:else}
        <tr><td colspan="8"><div class="empty">No org activity or policies.</div></td></tr>
      {/if}
    </tbody>
  </table>
</div>
