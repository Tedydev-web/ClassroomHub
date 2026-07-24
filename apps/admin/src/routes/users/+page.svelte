<script lang="ts">
  import type { AdminUserRow } from '$lib/types';
  import { initials, relativeTime } from '$lib/format';

  import { useAdmin } from '$lib/context';

  const { api } = useAdmin();

  let rows = $state<AdminUserRow[]>([]);
  let total = $state(0);
  let pageNum = $state(1);
  let search = $state('');
  let loading = $state(true);
  let error = $state('');
  let impersonating = $state<string | null>(null);

  const pageSize = 20;
  const lastPage = $derived(Math.max(1, Math.ceil(total / pageSize)));

  async function load() {
    loading = true;
    error = '';
    try {
      const result = await api.listUsers(pageNum, search.trim() || undefined);
      rows = result.users;
      total = result.total;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load users';
      rows = [];
    } finally {
      loading = false;
    }
  }

  // Debounce search so a keystroke does not fire a request; reset to page 1 when
  // the term changes so results are never a stale page of a different query.
  let debounce: ReturnType<typeof setTimeout>;
  let firstRun = true;
  $effect(() => {
    void search;
    if (firstRun) {
      firstRun = false;
      load();
      return;
    }
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      pageNum = 1;
      load();
    }, 300);
  });

  function go(delta: number) {
    const next = Math.min(lastPage, Math.max(1, pageNum + delta));
    if (next === pageNum) return;
    pageNum = next;
    load();
  }

  async function loginAs(user: AdminUserRow) {
    impersonating = user.id;
    try {
      const { loginUrl } = await api.impersonate(user.id);
      window.open(loginUrl, '_blank', 'noopener');
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to create login link';
    } finally {
      impersonating = null;
    }
  }
</script>

<div class="head">
  <div>
    <h1>Users</h1>
    <p class="sub">{total.toLocaleString()} total</p>
  </div>
  <input class="input search" type="search" placeholder="Search name or email…" bind:value={search} />
</div>

{#if error}
  <p class="error-text" role="alert" style="margin-bottom: var(--sp-3)">{error}</p>
{/if}

<div class="table-wrap">
  <table class="data">
    <thead>
      <tr>
        <th>User</th>
        <th>Status</th>
        <th class="num">Orgs</th>
        <th class="num">Courses</th>
        <th>Joined</th>
        <th class="actions-col"></th>
      </tr>
    </thead>
    <tbody>
      {#if loading}
        {#each Array(8) as _, i (i)}
          <tr>
            <td>
              <div class="user-cell">
                <div class="avatar skeleton"></div>
                <div style="flex:1">
                  <div class="skeleton" style="height:12px;width:40%;margin-bottom:6px"></div>
                  <div class="skeleton" style="height:10px;width:60%"></div>
                </div>
              </div>
            </td>
            <td><div class="skeleton" style="height:16px;width:56px"></div></td>
            <td class="num"><div class="skeleton" style="height:12px;width:20px;margin-left:auto"></div></td>
            <td class="num"><div class="skeleton" style="height:12px;width:20px;margin-left:auto"></div></td>
            <td><div class="skeleton" style="height:12px;width:70px"></div></td>
            <td></td>
          </tr>
        {/each}
      {:else if rows.length === 0}
        <tr>
          <td colspan="6">
            <div class="empty">
              {search.trim() ? `No users match “${search.trim()}”.` : 'No users yet.'}
            </div>
          </td>
        </tr>
      {:else}
        {#each rows as u (u.id)}
          <tr>
            <td>
              <a class="user-cell" href={`/users/${u.id}`}>
                {#if u.image}
                  <img class="avatar" src={u.image} alt="" referrerpolicy="no-referrer" />
                {:else}
                  <span class="avatar fallback">{initials(u.name, u.email)}</span>
                {/if}
                <span class="user-text">
                  <span class="user-name">{u.name || '—'}</span>
                  <span class="user-email">{u.email}</span>
                </span>
              </a>
            </td>
            <td>
              <span class="status">
                {#if u.banned}
                  <span class="badge badge-danger">Banned</span>
                {:else if u.role === 'admin'}
                  <span class="badge badge-accent">Super-admin</span>
                {:else if u.emailVerified}
                  <span class="badge badge-success">Verified</span>
                {:else}
                  <span class="badge badge-neutral">Unverified</span>
                {/if}
              </span>
            </td>
            <td class="num">{u.orgCount}</td>
            <td class="num">{u.courseCount}</td>
            <td class="joined">{relativeTime(u.createdAt)}</td>
            <td class="actions-col">
              <div class="row-actions">
                <a class="btn btn-sm" href={`/users/${u.id}`}>View</a>
                <button class="btn btn-sm" onclick={() => loginAs(u)} disabled={impersonating === u.id}>
                  {impersonating === u.id ? '…' : 'Login as'}
                </button>
              </div>
            </td>
          </tr>
        {/each}
      {/if}
    </tbody>
  </table>
</div>

{#if !loading && rows.length > 0}
  <div class="pager">
    <span class="pager-info tabular">Page {pageNum} of {lastPage}</span>
    <div class="pager-btns">
      <button class="btn btn-sm" onclick={() => go(-1)} disabled={pageNum <= 1}>Previous</button>
      <button class="btn btn-sm" onclick={() => go(1)} disabled={pageNum >= lastPage}>Next</button>
    </div>
  </div>
{/if}

<style>
  .head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--sp-4);
    margin-bottom: var(--sp-4);
  }
  .sub {
    margin: 4px 0 0;
    color: var(--muted);
    font-size: 13px;
  }
  .search {
    width: 280px;
    max-width: 50vw;
  }
  .actions-col {
    width: 1%;
  }
  .user-cell {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    color: var(--text);
    min-width: 220px;
  }
  .user-cell:hover {
    text-decoration: none;
  }
  .user-cell:hover .user-name {
    color: var(--accent);
  }
  .avatar {
    width: 32px;
    height: 32px;
    border-radius: 999px;
    object-fit: cover;
    flex-shrink: 0;
  }
  .avatar.fallback {
    display: grid;
    place-items: center;
    background: var(--accent-weak);
    color: var(--accent);
    font-size: 12px;
    font-weight: 600;
  }
  .user-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .user-name {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .user-email {
    color: var(--muted);
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .joined {
    color: var(--muted);
    white-space: nowrap;
  }
  .row-actions {
    display: flex;
    gap: var(--sp-2);
    justify-content: flex-end;
  }
  .pager {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: var(--sp-4);
  }
  .pager-info {
    color: var(--muted);
    font-size: 13px;
  }
  .pager-btns {
    display: flex;
    gap: var(--sp-2);
  }
</style>
