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

<div class="mb-4 flex items-end justify-between gap-4">
  <div>
    <h1>Users</h1>
    <p class="text-muted mt-1 text-[13px]">{total.toLocaleString()} total</p>
  </div>
  <input class="input w-[280px] max-w-[50vw]" type="search" placeholder="Search name or email…" bind:value={search} />
</div>

{#if error}
  <p class="error-text mb-3" role="alert">{error}</p>
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
        <th class="w-px"></th>
      </tr>
    </thead>
    <tbody>
      {#if loading}
        {#each Array(8) as _, i (i)}
          <tr>
            <td>
              <div class="flex items-center gap-3">
                <div class="skeleton h-8 w-8 rounded-full"></div>
                <div class="flex-1">
                  <div class="skeleton mb-1.5 h-3 w-2/5"></div>
                  <div class="skeleton h-2.5 w-3/5"></div>
                </div>
              </div>
            </td>
            <td><div class="skeleton h-4 w-14"></div></td>
            <td class="num"><div class="skeleton ml-auto h-3 w-5"></div></td>
            <td class="num"><div class="skeleton ml-auto h-3 w-5"></div></td>
            <td><div class="skeleton h-3 w-[70px]"></div></td>
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
              <a
                class="group text-text flex min-w-[220px] items-center gap-3 hover:no-underline"
                href={`/users/${u.id}`}
              >
                {#if u.image}
                  <img
                    class="h-8 w-8 shrink-0 rounded-full object-cover"
                    src={u.image}
                    alt=""
                    referrerpolicy="no-referrer"
                  />
                {:else}
                  <span
                    class="bg-accent-weak text-accent grid h-8 w-8 shrink-0 place-items-center rounded-full text-[12px] font-semibold"
                    >{initials(u.name, u.email)}</span
                  >
                {/if}
                <span class="flex min-w-0 flex-col">
                  <span class="group-hover:text-accent truncate font-medium">{u.name || '—'}</span>
                  <span class="text-muted truncate text-[12px]">{u.email}</span>
                </span>
              </a>
            </td>
            <td>
              {#if u.banned}
                <span class="badge badge-danger">Banned</span>
              {:else if u.role === 'admin'}
                <span class="badge badge-accent">Super-admin</span>
              {:else if u.emailVerified}
                <span class="badge badge-success">Verified</span>
              {:else}
                <span class="badge badge-neutral">Unverified</span>
              {/if}
            </td>
            <td class="num">{u.orgCount}</td>
            <td class="num">{u.courseCount}</td>
            <td class="text-muted whitespace-nowrap">{relativeTime(u.createdAt)}</td>
            <td class="w-px">
              <div class="flex justify-end gap-2">
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
  <div class="mt-4 flex items-center justify-between">
    <span class="tabular text-muted text-[13px]">Page {pageNum} of {lastPage}</span>
    <div class="flex gap-2">
      <button class="btn btn-sm" onclick={() => go(-1)} disabled={pageNum <= 1}>Previous</button>
      <button class="btn btn-sm" onclick={() => go(1)} disabled={pageNum >= lastPage}>Next</button>
    </div>
  </div>
{/if}
