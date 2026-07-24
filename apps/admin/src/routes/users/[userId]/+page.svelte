<script lang="ts">
  import type { AdminUserWithStats, ChatConversation, ChatSummary } from '$lib/types';
  import { chatToPlainText, formatDate, initials, relativeTime } from '$lib/format';

  import { page } from '$app/stores';
  import { useAdmin } from '$lib/context';

  const { api } = useAdmin();
  const userId = $derived($page.params.userId);

  let user = $state<AdminUserWithStats | null>(null);
  let loading = $state(true);
  let error = $state('');

  let chats = $state<ChatSummary[]>([]);
  let chatsLoaded = $state(false);
  let openChatId = $state<string | null>(null);
  let openChat = $state<ChatConversation | null>(null);
  let copiedId = $state<string | null>(null);

  let creditInputs = $state<Record<string, string>>({});
  let savingOrg = $state<string | null>(null);
  let impersonating = $state(false);

  $effect(() => {
    const id = userId;
    if (!id) return;
    loading = true;
    error = '';
    chatsLoaded = false;
    openChatId = null;
    api
      .getUser(id)
      .then((u) => {
        user = u;
      })
      .catch((e) => {
        error = e instanceof Error ? e.message : 'Failed to load user';
      })
      .finally(() => {
        loading = false;
      });
  });

  async function loadChats() {
    if (chatsLoaded || !user) return;
    try {
      chats = await api.listChats(user.id);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load conversations';
    } finally {
      chatsLoaded = true;
    }
  }

  async function toggleChat(id: string) {
    if (openChatId === id) {
      openChatId = null;
      openChat = null;
      return;
    }
    openChatId = id;
    openChat = null;
    if (!user) return;
    try {
      openChat = await api.getChat(user.id, id);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load conversation';
    }
  }

  async function copyChat(id: string) {
    if (!openChat) return;
    await navigator.clipboard.writeText(chatToPlainText(openChat));
    copiedId = id;
    setTimeout(() => {
      if (copiedId === id) copiedId = null;
    }, 1500);
  }

  async function addCredits(orgId: string) {
    const raw = creditInputs[orgId];
    const amount = Number(raw);
    if (!Number.isInteger(amount) || amount <= 0) return;
    savingOrg = orgId;
    try {
      const { balance } = await api.addCredits(orgId, amount);
      if (user) {
        user.orgs = user.orgs.map((o) => (o.orgId === orgId ? { ...o, creditBalance: balance } : o));
      }
      creditInputs[orgId] = '';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to add credits';
    } finally {
      savingOrg = null;
    }
  }

  async function loginAs() {
    if (!user) return;
    impersonating = true;
    try {
      const { loginUrl } = await api.impersonate(user.id);
      window.open(loginUrl, '_blank', 'noopener');
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to create login link';
    } finally {
      impersonating = false;
    }
  }

  const roleLabel = (roleId: number) => (roleId === 1 ? 'Admin' : roleId === 2 ? 'Teacher' : 'Student');
</script>

<a class="text-muted mb-3 inline-block text-[13px]" href="/users">← Users</a>

{#if error}<p class="error-text my-3" role="alert">{error}</p>{/if}

{#if loading}
  <div class="card flex items-center gap-4 p-5">
    <div class="skeleton h-14 w-14 rounded-full"></div>
    <div class="flex-1">
      <div class="skeleton mb-2 h-[18px] w-[180px]"></div>
      <div class="skeleton h-3 w-[240px]"></div>
    </div>
  </div>
{:else if user}
  <div class="card flex flex-wrap items-center gap-4 p-5">
    {#if user.image}
      <img class="h-14 w-14 shrink-0 rounded-full object-cover" src={user.image} alt="" referrerpolicy="no-referrer" />
    {:else}
      <span
        class="bg-accent-weak text-accent grid h-14 w-14 shrink-0 place-items-center rounded-full text-[20px] font-semibold"
        >{initials(user.name, user.email)}</span
      >
    {/if}
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <h1>{user.name || 'Unnamed user'}</h1>
        {#if user.banned}<span class="badge badge-danger">Banned</span>
        {:else if user.role === 'admin'}<span class="badge badge-accent">Super-admin</span>
        {:else if user.emailVerified}<span class="badge badge-success">Verified</span>
        {:else}<span class="badge badge-neutral">Unverified</span>{/if}
      </div>
      <p class="text-text mt-1 mb-0.5 text-[14px]">{user.email}</p>
      <p class="text-muted m-0 text-[12px] break-all">
        Joined {formatDate(user.createdAt)} · <span class="tabular">{user.id}</span>
      </p>
    </div>
    <button class="btn btn-primary" onclick={loginAs} disabled={impersonating}>
      {impersonating ? 'Opening…' : 'Login as user'}
    </button>
  </div>

  <div class="my-6 mt-4 grid grid-cols-4 gap-3 max-[640px]:grid-cols-2">
    <div class="card flex flex-col gap-0.5 p-4">
      <span class="tabular text-[22px] font-semibold tracking-[-0.02em]">{user.orgCount}</span><span
        class="text-muted text-[12px]">Orgs</span
      >
    </div>
    <div class="card flex flex-col gap-0.5 p-4">
      <span class="tabular text-[22px] font-semibold tracking-[-0.02em]">{user.adminOrgCount}</span><span
        class="text-muted text-[12px]">Admin of</span
      >
    </div>
    <div class="card flex flex-col gap-0.5 p-4">
      <span class="tabular text-[22px] font-semibold tracking-[-0.02em]">{user.courseCount}</span><span
        class="text-muted text-[12px]">Courses</span
      >
    </div>
    <div class="card flex flex-col gap-0.5 p-4">
      <span class="text-[22px] font-semibold tracking-[-0.02em]"
        >{user.banned ? 'Banned' : user.emailVerified ? 'Active' : 'Pending'}</span
      ><span class="text-muted text-[12px]">Status</span>
    </div>
  </div>

  <section class="mb-6">
    <h2 class="mb-3">Organizations & credits</h2>
    {#if user.orgs.length === 0}
      <div class="card"><div class="empty">Not a member of any organization.</div></div>
    {:else}
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr><th>Organization</th><th>Role</th><th class="num">AI credits</th><th class="w-px">Add</th></tr>
          </thead>
          <tbody>
            {#each user.orgs as org (org.orgId)}
              <tr>
                <td>
                  <span class="block font-medium">{org.name}</span>
                  {#if org.siteName}<span class="text-muted text-[12px]">{org.siteName}.classroom.io.vn</span>{/if}
                </td>
                <td><span class="badge badge-neutral">{roleLabel(org.roleId)}</span></td>
                <td class="num">{org.creditBalance.toLocaleString()}</td>
                <td class="w-px">
                  <form class="flex justify-end gap-2" onsubmit={(e) => (e.preventDefault(), addCredits(org.orgId))}>
                    <input
                      class="input tabular h-[28px] w-[90px] px-2 text-[12px]"
                      type="number"
                      min="1"
                      placeholder="0"
                      bind:value={creditInputs[org.orgId]}
                      aria-label={`Credits to add to ${org.name}`}
                    />
                    <button
                      class="btn btn-sm"
                      type="submit"
                      disabled={savingOrg === org.orgId || !creditInputs[org.orgId]}
                    >
                      {savingOrg === org.orgId ? '…' : 'Add'}
                    </button>
                  </form>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <section class="mb-6">
    <div class="mb-3 flex items-center justify-between">
      <h2>AI conversations</h2>
      {#if !chatsLoaded}
        <button class="btn btn-sm" onclick={loadChats}>Load</button>
      {/if}
    </div>
    {#if chatsLoaded}
      {#if chats.length === 0}
        <div class="card"><div class="empty">No AI conversations.</div></div>
      {:else}
        <div class="card overflow-hidden">
          {#each chats as chat (chat.id)}
            <div class="border-border border-b last:border-b-0">
              <button
                class="text-text hover:bg-surface-hover flex w-full items-center gap-3 border-none bg-transparent px-4 py-3 text-left"
                onclick={() => toggleChat(chat.id)}
                aria-expanded={openChatId === chat.id}
              >
                <span
                  class="text-faint transition-transform {openChatId === chat.id ? 'rotate-90' : ''}"
                  aria-hidden="true">▸</span
                >
                <span class="flex-1 truncate font-medium">{chat.title || 'Untitled conversation'}</span>
                <span class="tabular text-muted text-[12px] whitespace-nowrap"
                  >{chat.messageCount} msg · {relativeTime(chat.updatedAt)}</span
                >
              </button>
              {#if openChatId === chat.id}
                <div class="bg-bg py-0 pr-4 pb-4 pl-6">
                  {#if openChat}
                    <div class="py-3">
                      <button class="btn btn-sm" onclick={() => copyChat(chat.id)}>
                        {copiedId === chat.id ? 'Copied' : 'Copy chat'}
                      </button>
                    </div>
                    {#each openChat.messages as m, i (i)}
                      <div class="border-border border-t py-2">
                        <span class="text-muted mb-0.5 block text-[11px] font-semibold"
                          >{(m.role ?? 'message').toUpperCase()}</span
                        >
                        <div class="text-[13px] break-words whitespace-pre-wrap">
                          {typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}
                        </div>
                      </div>
                    {/each}
                  {:else}
                    <div class="empty p-4">Loading…</div>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </section>
{/if}
