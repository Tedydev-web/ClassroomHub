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

<a class="back" href="/users">← Users</a>

{#if error}<p class="error-text" role="alert" style="margin:var(--sp-3) 0">{error}</p>{/if}

{#if loading}
  <div class="card profile-head">
    <div class="avatar-lg skeleton"></div>
    <div style="flex:1">
      <div class="skeleton" style="height:18px;width:180px;margin-bottom:8px"></div>
      <div class="skeleton" style="height:12px;width:240px"></div>
    </div>
  </div>
{:else if user}
  <div class="card profile-head">
    {#if user.image}
      <img class="avatar-lg" src={user.image} alt="" referrerpolicy="no-referrer" />
    {:else}
      <span class="avatar-lg fallback">{initials(user.name, user.email)}</span>
    {/if}
    <div class="who">
      <div class="who-top">
        <h1>{user.name || 'Unnamed user'}</h1>
        {#if user.banned}<span class="badge badge-danger">Banned</span>
        {:else if user.role === 'admin'}<span class="badge badge-accent">Super-admin</span>
        {:else if user.emailVerified}<span class="badge badge-success">Verified</span>
        {:else}<span class="badge badge-neutral">Unverified</span>{/if}
      </div>
      <p class="who-email">{user.email}</p>
      <p class="who-meta">Joined {formatDate(user.createdAt)} · <span class="tabular">{user.id}</span></p>
    </div>
    <button class="btn btn-primary" onclick={loginAs} disabled={impersonating}>
      {impersonating ? 'Opening…' : 'Login as user'}
    </button>
  </div>

  <div class="stats">
    <div class="stat card">
      <span class="stat-num tabular">{user.orgCount}</span><span class="stat-label">Orgs</span>
    </div>
    <div class="stat card">
      <span class="stat-num tabular">{user.adminOrgCount}</span><span class="stat-label">Admin of</span>
    </div>
    <div class="stat card">
      <span class="stat-num tabular">{user.courseCount}</span><span class="stat-label">Courses</span>
    </div>
    <div class="stat card">
      <span class="stat-num">{user.banned ? 'Banned' : user.emailVerified ? 'Active' : 'Pending'}</span>
      <span class="stat-label">Status</span>
    </div>
  </div>

  <section>
    <h2>Organizations & credits</h2>
    {#if user.orgs.length === 0}
      <div class="card"><div class="empty">Not a member of any organization.</div></div>
    {:else}
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr><th>Organization</th><th>Role</th><th class="num">AI credits</th><th class="actions-col">Add</th></tr>
          </thead>
          <tbody>
            {#each user.orgs as org (org.orgId)}
              <tr>
                <td>
                  <span class="org-name">{org.name}</span>
                  {#if org.siteName}<span class="org-site">{org.siteName}.classroom.io.vn</span>{/if}
                </td>
                <td><span class="badge badge-neutral">{roleLabel(org.roleId)}</span></td>
                <td class="num">{org.creditBalance.toLocaleString()}</td>
                <td class="actions-col">
                  <form class="credit-form" onsubmit={(e) => (e.preventDefault(), addCredits(org.orgId))}>
                    <input
                      class="input input-sm tabular"
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

  <section>
    <div class="sec-head">
      <h2>AI conversations</h2>
      {#if !chatsLoaded}
        <button class="btn btn-sm" onclick={loadChats}>Load</button>
      {/if}
    </div>
    {#if chatsLoaded}
      {#if chats.length === 0}
        <div class="card"><div class="empty">No AI conversations.</div></div>
      {:else}
        <div class="card chat-list">
          {#each chats as chat (chat.id)}
            <div class="chat-item">
              <button class="chat-row" onclick={() => toggleChat(chat.id)} aria-expanded={openChatId === chat.id}>
                <span class="chat-caret" class:open={openChatId === chat.id}>▸</span>
                <span class="chat-title">{chat.title || 'Untitled conversation'}</span>
                <span class="chat-meta tabular">{chat.messageCount} msg · {relativeTime(chat.updatedAt)}</span>
              </button>
              {#if openChatId === chat.id}
                <div class="chat-body">
                  {#if openChat}
                    <div class="chat-actions">
                      <button class="btn btn-sm" onclick={() => copyChat(chat.id)}>
                        {copiedId === chat.id ? 'Copied' : 'Copy chat'}
                      </button>
                    </div>
                    {#each openChat.messages as m, i (i)}
                      <div class="msg">
                        <span class="msg-role">{(m.role ?? 'message').toUpperCase()}</span>
                        <div class="msg-text">
                          {typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}
                        </div>
                      </div>
                    {/each}
                  {:else}
                    <div class="empty" style="padding:var(--sp-4)">Loading…</div>
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

<style>
  .back {
    display: inline-block;
    margin-bottom: var(--sp-3);
    font-size: 13px;
    color: var(--muted);
  }
  .profile-head {
    display: flex;
    align-items: center;
    gap: var(--sp-4);
    padding: var(--sp-5);
  }
  .avatar-lg {
    width: 56px;
    height: 56px;
    border-radius: 999px;
    object-fit: cover;
    flex-shrink: 0;
  }
  .avatar-lg.fallback {
    display: grid;
    place-items: center;
    background: var(--accent-weak);
    color: var(--accent);
    font-size: 20px;
    font-weight: 600;
  }
  .who {
    flex: 1;
    min-width: 0;
  }
  .who-top {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }
  .who-email {
    margin: 4px 0 2px;
    color: var(--text);
    font-size: 14px;
  }
  .who-meta {
    margin: 0;
    color: var(--muted);
    font-size: 12px;
    word-break: break-all;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--sp-3);
    margin: var(--sp-4) 0 var(--sp-6);
  }
  .stat {
    padding: var(--sp-4);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .stat-num {
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  .stat-label {
    color: var(--muted);
    font-size: 12px;
  }
  section {
    margin-bottom: var(--sp-6);
  }
  section h2 {
    margin-bottom: var(--sp-3);
  }
  .sec-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--sp-3);
  }
  .sec-head h2 {
    margin-bottom: 0;
  }
  .org-name {
    font-weight: 500;
    display: block;
  }
  .org-site {
    color: var(--muted);
    font-size: 12px;
  }
  .actions-col {
    width: 1%;
  }
  .credit-form {
    display: flex;
    gap: var(--sp-2);
    justify-content: flex-end;
  }
  .input-sm {
    height: 28px;
    width: 90px;
    padding: 0 var(--sp-2);
    font-size: 12px;
  }
  .chat-list {
    overflow: hidden;
  }
  .chat-item {
    border-bottom: 1px solid var(--border);
  }
  .chat-item:last-child {
    border-bottom: none;
  }
  .chat-row {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    width: 100%;
    padding: var(--sp-3) var(--sp-4);
    background: none;
    border: none;
    cursor: pointer;
    font: inherit;
    text-align: left;
    color: var(--text);
  }
  .chat-row:hover {
    background: var(--surface-hover);
  }
  .chat-caret {
    color: var(--faint);
    transition: transform 0.12s ease;
  }
  .chat-caret.open {
    transform: rotate(90deg);
  }
  .chat-title {
    flex: 1;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chat-meta {
    color: var(--muted);
    font-size: 12px;
    white-space: nowrap;
  }
  .chat-body {
    padding: 0 var(--sp-4) var(--sp-4) var(--sp-6);
    background: var(--bg);
  }
  .chat-actions {
    padding: var(--sp-3) 0;
  }
  .msg {
    padding: var(--sp-2) 0;
    border-top: 1px solid var(--border);
  }
  .msg-role {
    display: block;
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    margin-bottom: 2px;
  }
  .msg-text {
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 13px;
  }
  @media (max-width: 640px) {
    .stats {
      grid-template-columns: repeat(2, 1fr);
    }
    .profile-head {
      flex-wrap: wrap;
    }
  }
</style>
