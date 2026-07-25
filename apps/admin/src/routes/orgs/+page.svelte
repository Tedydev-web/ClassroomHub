<script lang="ts">
  import type { OrgFeatures } from '$lib/types';

  import { useAdmin } from '$lib/context';

  const { api } = useAdmin();

  let data = $state<OrgFeatures | null>(null);
  let loading = $state(true);
  let error = $state('');
  /** `${orgId}:${key}` of the switch currently in flight, so only it disables. */
  let saving = $state<string | null>(null);
  let search = $state('');

  async function refresh() {
    loading = true;
    error = '';
    try {
      data = await api.orgFeatures();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load organization features';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    refresh();
  });

  const orgs = $derived.by(() => {
    const rows = data?.orgs ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (org) => org.name.toLowerCase().includes(term) || (org.siteName ?? '').toLowerCase().includes(term)
    );
  });

  async function toggle(orgId: string, key: string, next: boolean) {
    saving = `${orgId}:${key}`;
    error = '';

    // Applied locally first so the switch responds immediately; a failed request
    // rolls it back below rather than leaving the row lying about its state.
    const org = data?.orgs.find((row) => row.orgId === orgId);
    const previous = org?.features[key];
    if (org) org.features[key] = next;

    try {
      await api.setOrgFeatures(orgId, { [key]: next });
    } catch (e) {
      if (org && previous !== undefined) org.features[key] = previous;
      error = e instanceof Error ? e.message : 'Failed to update features';
    } finally {
      saving = null;
    }
  }

  function disabledCount(features: Record<string, boolean>): number {
    return Object.values(features).filter((enabled) => !enabled).length;
  }

  /**
   * The catalog arrives flat but already in sidebar order, so consecutive
   * entries sharing a group are collected into one section. Built once rather
   * than per org row.
   */
  const catalogGroups = $derived.by(() => {
    const groups: Array<{ label: string; entries: OrgFeatures['catalog'] }> = [];

    for (const entry of data?.catalog ?? []) {
      const last = groups[groups.length - 1];
      if (last?.label === entry.group) {
        last.entries.push(entry);
      } else {
        groups.push({ label: entry.group, entries: [entry] });
      }
    }

    return groups;
  });
</script>

<div class="mb-4 flex items-end justify-between gap-4">
  <div>
    <h1>Organizations — sidebar features</h1>
    <p class="text-muted mt-1 text-[13px]">
      Switch capabilities off per tenant. A switched-off feature is removed from that org's sidebar and its route
      redirects to the org home. Everything is on unless you turn it off.
    </p>
  </div>
  <button class="btn btn-sm" onclick={refresh} disabled={loading}>Refresh</button>
</div>

{#if error}<p class="error-text mb-3" role="alert">{error}</p>{/if}

<div class="mb-3">
  <input
    class="input h-[30px] w-[260px] px-2 text-[13px]"
    type="search"
    placeholder="Filter by name or site name…"
    bind:value={search}
    aria-label="Filter organizations"
  />
</div>

{#if loading}
  <div class="table-wrap">
    <table class="data">
      <tbody>
        {#each Array(4) as _, i (i)}
          <tr><td><div class="skeleton h-3 w-56"></div></td></tr>
        {/each}
      </tbody>
    </table>
  </div>
{:else if orgs.length === 0}
  <p class="text-muted text-[13px]">
    {search.trim() ? 'No organization matches that filter.' : 'No organizations yet.'}
  </p>
{:else}
  {#each orgs as org (org.orgId)}
    {@const off = disabledCount(org.features)}
    <section class="border-border bg-surface mb-3 rounded-[8px] border p-4">
      <header class="mb-3 flex items-baseline justify-between gap-3">
        <div class="min-w-0">
          <h2 class="truncate text-[14px] font-semibold">{org.name}</h2>
          <p class="text-muted mt-0.5 truncate text-[12px]">{org.siteName ?? '—'}</p>
        </div>
        <span class="badge {off > 0 ? 'badge-neutral' : 'badge-success'}">
          {off > 0 ? `${off} off` : 'All on'}
        </span>
      </header>

      {#each catalogGroups as group (group.label)}
        <p class="text-muted mt-3 mb-1.5 text-[11px] font-semibold tracking-wide uppercase first:mt-0">
          {group.label}
        </p>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-4 gap-y-2">
          {#each group.entries as entry (entry.key)}
            {@const enabled = org.features[entry.key] !== false}
            {@const busy = saving === `${org.orgId}:${entry.key}`}
            <label class="flex cursor-pointer items-center gap-2 text-[13px] {busy ? 'opacity-60' : ''}">
              <input
                type="checkbox"
                checked={enabled}
                disabled={busy}
                onchange={(e) => toggle(org.orgId, entry.key, e.currentTarget.checked)}
              />
              <span class={enabled ? '' : 'text-muted line-through'}>{entry.label}</span>
            </label>
          {/each}
        </div>
      {/each}
    </section>
  {/each}
{/if}
