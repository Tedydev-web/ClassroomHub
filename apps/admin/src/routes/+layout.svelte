<script lang="ts">
  import '../app.css';

  import { AdminApi } from '$lib/api.svelte';
  import { currentTheme, toggleTheme, type Theme } from '$lib/theme';
  import { page } from '$app/stores';
  import { setAdminContext } from '$lib/context';

  let { children } = $props();

  let theme = $state<Theme>('light');
  $effect(() => {
    theme = currentTheme();
  });
  function flipTheme() {
    theme = toggleTheme();
  }

  const STORAGE_KEY = 'ch-admin-key';

  // 'checking' while we validate a stored key on load; 'locked' shows the gate;
  // 'unlocked' shows the app. Keeps the first paint from flashing the gate for an
  // operator who is already authenticated.
  let phase = $state<'checking' | 'locked' | 'unlocked'>('checking');
  let password = $state('');
  let submitting = $state(false);
  let error = $state('');
  let api = $state<AdminApi | null>(null);

  function activate(key: string) {
    api = new AdminApi(key);
    setAdminContext({
      get api() {
        if (!api) throw new Error('not authenticated');
        return api;
      },
      signOut
    });
    phase = 'unlocked';
  }

  function signOut() {
    sessionStorage.removeItem(STORAGE_KEY);
    api = null;
    password = '';
    phase = 'locked';
  }

  async function validateAndEnter(key: string) {
    const client = new AdminApi(key);
    await client.verify();
    sessionStorage.setItem(STORAGE_KEY, key);
    activate(key);
  }

  async function onSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (!password || submitting) return;
    submitting = true;
    error = '';
    try {
      await validateAndEnter(password);
    } catch (e) {
      error = e instanceof Error && e.message.includes('401') ? 'Wrong password' : 'Wrong password or API unreachable';
    } finally {
      submitting = false;
    }
  }

  // Runs once on the client (ssr is off). Try a stored key silently; fall back to
  // the gate if it is missing or no longer valid.
  $effect(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored) {
      phase = 'locked';
      return;
    }
    new AdminApi(stored)
      .verify()
      .then(() => activate(stored))
      .catch(() => {
        sessionStorage.removeItem(STORAGE_KEY);
        phase = 'locked';
      });
  });

  const nav = [
    { href: '/users', label: 'Users' },
    { href: '/orgs/new', label: 'Create org' }
  ];
  const path = $derived($page.url.pathname);
</script>

{#snippet themeToggle()}
  <button
    class="btn btn-ghost btn-sm theme-btn"
    type="button"
    onclick={flipTheme}
    aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
    title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
  >
    {#if theme === 'dark'}
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4.5" /><path
          d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
        />
      </svg>
    {:else}
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
      </svg>
    {/if}
  </button>
{/snippet}

{#if phase === 'checking'}
  <div class="center">
    <div class="brand-mark" aria-hidden="true">C</div>
  </div>
{:else if phase === 'locked'}
  <div class="center">
    <form class="gate card" onsubmit={onSubmit}>
      <div class="brand-mark" aria-hidden="true">C</div>
      <h1>ClassroomHub Admin</h1>
      <p class="gate-sub">Operator access. Enter the super-admin password.</p>
      <div class="gate-toggle">{@render themeToggle()}</div>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="input"
        type="password"
        placeholder="Super-admin password"
        bind:value={password}
        autofocus
        autocomplete="off"
        aria-label="Super-admin password"
      />
      {#if error}<p class="error-text" role="alert">{error}</p>{/if}
      <button class="btn btn-primary" type="submit" disabled={submitting || !password}>
        {submitting ? 'Unlocking…' : 'Unlock'}
      </button>
    </form>
  </div>
{:else}
  <div class="shell">
    <header class="topbar">
      <a class="brand" href="/users">
        <span class="brand-mark sm" aria-hidden="true">C</span>
        <span class="brand-name">ClassroomHub <b>Admin</b></span>
      </a>
      <nav class="nav">
        {#each nav as item (item.href)}
          <a class="nav-link" class:active={path === item.href || path.startsWith(item.href + '/')} href={item.href}>
            {item.label}
          </a>
        {/each}
      </nav>
      {@render themeToggle()}
      <button class="btn btn-ghost btn-sm" type="button" onclick={signOut}>Sign out</button>
    </header>
    <main class="content">
      {@render children()}
    </main>
  </div>
{/if}

<style>
  .center {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: var(--sp-4);
  }
  .brand-mark {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 10px;
    background: var(--accent);
    color: #fff;
    font-weight: 700;
    font-size: 24px;
  }
  .brand-mark.sm {
    width: 26px;
    height: 26px;
    border-radius: 6px;
    font-size: 15px;
  }
  .gate {
    width: 340px;
    max-width: 100%;
    padding: var(--sp-6);
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    align-items: stretch;
    text-align: center;
    box-shadow: var(--shadow-md);
  }
  .gate .brand-mark {
    margin: 0 auto;
  }
  .gate h1 {
    margin-top: var(--sp-1);
  }
  .gate-sub {
    margin: 0 0 var(--sp-2);
    color: var(--muted);
    font-size: 13px;
  }
  .gate .input {
    text-align: left;
  }
  .gate {
    position: relative;
  }
  .gate-toggle {
    position: absolute;
    top: var(--sp-3);
    right: var(--sp-3);
  }
  .theme-btn {
    width: 30px;
    padding: 0;
    color: var(--muted);
  }
  .theme-btn:hover {
    color: var(--text);
  }
  .theme-btn svg {
    display: block;
  }

  .shell {
    min-height: 100vh;
  }
  .topbar {
    display: flex;
    align-items: center;
    gap: var(--sp-5);
    height: 52px;
    padding: 0 var(--sp-5);
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    color: var(--text);
  }
  .brand:hover {
    text-decoration: none;
  }
  .brand-name {
    font-size: 14px;
    font-weight: 500;
  }
  .brand-name b {
    font-weight: 600;
  }
  .nav {
    display: flex;
    gap: var(--sp-1);
    margin-right: auto;
  }
  .nav-link {
    padding: 6px var(--sp-3);
    border-radius: var(--radius);
    color: var(--muted);
    font-size: 13px;
    font-weight: 500;
  }
  .nav-link:hover {
    background: var(--surface-hover);
    color: var(--text);
    text-decoration: none;
  }
  .nav-link.active {
    color: var(--accent);
    background: var(--accent-weak);
  }
  .content {
    max-width: 1080px;
    margin: 0 auto;
    padding: var(--sp-6) var(--sp-5);
  }
  @media (max-width: 640px) {
    .topbar {
      gap: var(--sp-3);
      padding: 0 var(--sp-3);
    }
    .brand-name {
      display: none;
    }
    .content {
      padding: var(--sp-4) var(--sp-3);
    }
  }
</style>
