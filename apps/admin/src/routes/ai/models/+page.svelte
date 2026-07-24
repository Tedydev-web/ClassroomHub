<script lang="ts">
  import type { GatewaySettings } from '$lib/types';
  import { modelRoleBadge, toggleModelVisibility } from '$lib/gateway';
  import { useAdmin } from '$lib/context';

  const { api } = useAdmin();

  let settings = $state<GatewaySettings | null>(null);
  let loading = $state(true);
  let error = $state('');
  /** modelId currently being toggled, so only its own row shows a disabled button. */
  let saving = $state<string | null>(null);

  async function refresh() {
    loading = true;
    error = '';
    try {
      settings = await api.gatewaySettings();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load gateway settings';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    refresh();
  });

  async function toggleVisible(modelId: string) {
    if (!settings) return;

    saving = modelId;
    error = '';
    try {
      const nextAllowlist = toggleModelVisibility(settings.modelAllowlist, modelId);
      settings = await api.updateGatewaySettings({ modelAllowlist: nextAllowlist });
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to update model visibility';
    } finally {
      saving = null;
    }
  }
</script>

<div class="mb-4 flex items-end justify-between gap-4">
  <div>
    <h1>Gateway — models</h1>
    <p class="text-muted mt-1 text-[13px]">
      The chat picker shows exactly the visible models below — this allowlist is its only source. Hiding a model keeps
      it routable; it just stops being offered.
    </p>
  </div>
  <button class="btn btn-sm" onclick={refresh} disabled={loading}>Refresh</button>
</div>

{#if error}<p class="error-text mb-3" role="alert">{error}</p>{/if}

<div class="table-wrap">
  <table class="data">
    <thead>
      <tr>
        <th>Model ID</th>
        <th>Label</th>
        <th>Role</th>
        <th>Picker</th>
        <th class="w-px"></th>
      </tr>
    </thead>
    <tbody>
      {#if loading}
        {#each Array(3) as _, i (i)}
          <tr>
            <td><div class="skeleton h-3 w-40"></div></td>
            <td><div class="skeleton h-3 w-32"></div></td>
            <td><div class="skeleton h-3 w-14"></div></td>
            <td><div class="skeleton h-3 w-14"></div></td>
            <td></td>
          </tr>
        {/each}
      {:else if settings && settings.modelAllowlist.length > 0}
        {#each settings.modelAllowlist as entry (entry.modelId)}
          {@const visible = entry.visible !== false}
          <tr>
            <td class="tabular text-[12px]">{entry.modelId}</td>
            <td>{entry.label}</td>
            <td><span class="badge {modelRoleBadge(entry.role)}">{entry.role}</span></td>
            <td>
              <span class="badge {visible ? 'badge-success' : 'badge-neutral'}">
                {visible ? 'Visible' : 'Hidden'}
              </span>
            </td>
            <td class="w-px">
              <button
                class="btn btn-sm"
                onclick={() => toggleVisible(entry.modelId)}
                disabled={saving === entry.modelId}
              >
                {visible ? 'Hide' : 'Show'}
              </button>
            </td>
          </tr>
        {/each}
      {:else}
        <tr><td colspan="5"><div class="empty">No models in the gateway allowlist yet.</div></td></tr>
      {/if}
    </tbody>
  </table>
</div>
