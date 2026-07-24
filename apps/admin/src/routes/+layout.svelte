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
    phase = 'unlocked';
  }

  function signOut() {
    sessionStorage.removeItem(STORAGE_KEY);
    api = null;
    password = '';
    phase = 'locked';
  }

  // Register the admin context ONCE during component init. setContext is illegal
  // in the async auth handlers (activate runs after an await), so it must live at
  // init; the getter reads the reactive `api` state and returns the client the
  // moment the gate authorizes.
  setAdminContext({
    get api() {
      if (!api) throw new Error('not authenticated');
      return api;
    },
    signOut
  });

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
    { href: '/orgs/new', label: 'Create org' },
    { href: '/ai', label: 'AI Gateway' }
  ];
  const path = $derived($page.url.pathname);
</script>

{#snippet brandIdentity(compact: boolean)}
  <span class="inline-flex items-center gap-2 rounded-[6px] bg-white px-2 py-1">
    <img src="/wordmark.svg" alt="ClassroomHub" class={compact ? 'hidden h-6 w-auto sm:block' : 'h-12 w-auto'} />
    {#if compact}
      <img src="/logo.svg" alt="ClassroomHub" class="h-7 w-7 sm:hidden" />
    {/if}
    <strong class="text-[13px] font-semibold text-[#07152f] {compact ? 'hidden sm:inline' : ''}">Admin</strong>
  </span>
{/snippet}

{#snippet themeToggle()}
  <button
    class="btn btn-ghost btn-sm text-muted hover:text-text w-[30px] px-0"
    type="button"
    onclick={flipTheme}
    aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
    title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
  >
    {#if theme === 'dark'}
      <svg
        class="block"
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
        class="block"
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
  <div class="grid min-h-screen place-items-center p-4">{@render brandIdentity(false)}</div>
{:else if phase === 'locked'}
  <div class="grid min-h-screen place-items-center p-4">
    <form
      class="card relative flex w-[340px] max-w-full flex-col items-stretch gap-3 p-8 text-center shadow-[0_4px_12px_rgba(0,0,0,0.08)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
      onsubmit={onSubmit}
    >
      <div class="absolute top-3 right-3">{@render themeToggle()}</div>
      <div class="mx-auto">{@render brandIdentity(false)}</div>
      <h1 class="mt-1">Admin access</h1>
      <p class="text-muted mb-2 text-[13px]">Operator access. Enter the super-admin password.</p>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="input text-left"
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
  <div class="min-h-screen">
    <header
      class="border-border bg-surface sticky top-0 z-10 flex h-[52px] items-center gap-6 border-b px-6 max-[640px]:gap-3 max-[640px]:px-3"
    >
      <a class="text-text inline-flex items-center hover:no-underline" href="/users">
        {@render brandIdentity(true)}
      </a>
      <nav class="mr-auto flex gap-1">
        {#each nav as item (item.href)}
          <a
            class="rounded-[6px] px-3 py-1.5 text-[13px] font-medium {path === item.href ||
            path.startsWith(item.href + '/')
              ? 'bg-accent-weak text-accent'
              : 'text-muted hover:bg-surface-hover hover:text-text hover:no-underline'}"
            href={item.href}
          >
            {item.label}
          </a>
        {/each}
      </nav>
      {@render themeToggle()}
      <button class="btn btn-ghost btn-sm" type="button" onclick={signOut}>Sign out</button>
    </header>
    <main class="mx-auto max-w-[1080px] px-6 py-8 max-[640px]:px-3 max-[640px]:py-4">
      {@render children()}
    </main>
  </div>
{/if}
