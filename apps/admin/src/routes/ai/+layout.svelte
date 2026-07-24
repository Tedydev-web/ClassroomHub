<script lang="ts">
  import { page } from '$app/stores';

  let { children } = $props();

  const tabs = [
    { href: '/ai', label: 'Overview' },
    { href: '/ai/orgs', label: 'Organizations' },
    { href: '/ai/runs', label: 'Runs' }
  ];
  const path = $derived($page.url.pathname);
</script>

<nav class="border-border mb-6 flex gap-1 border-b" aria-label="AI Gateway sections">
  {#each tabs as tab (tab.href)}
    <a
      class="-mb-px border-b-2 px-3 py-2 text-[13px] font-medium {path === tab.href
        ? 'border-accent text-accent'
        : 'text-muted hover:text-text border-transparent hover:no-underline'}"
      href={tab.href}
      aria-current={path === tab.href ? 'page' : undefined}
    >
      {tab.label}
    </a>
  {/each}
</nav>

{@render children()}
