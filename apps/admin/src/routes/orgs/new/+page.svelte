<script lang="ts">
  import type { CreatedOrg } from '$lib/types';

  import { useAdmin } from '$lib/context';

  const { api } = useAdmin();

  let name = $state('');
  let siteName = $state('');
  let ownerUserId = $state('');
  let submitting = $state(false);
  let error = $state('');
  let created = $state<CreatedOrg | null>(null);
  let openingOwner = $state(false);

  const siteHint = $derived(
    siteName.trim() ? `${siteName.trim()}.classroom.io.vn` : 'e.g. msna → msna.classroom.io.vn'
  );

  async function onSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (submitting) return;
    submitting = true;
    error = '';
    try {
      created = await api.createOrg({
        name: name.trim(),
        siteName: siteName.trim().toLowerCase(),
        ownerUserId: ownerUserId.trim()
      });
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to create organization';
    } finally {
      submitting = false;
    }
  }

  function reset() {
    created = null;
    name = '';
    siteName = '';
    ownerUserId = '';
  }

  async function loginAsOwner() {
    if (!created) return;
    openingOwner = true;
    try {
      const { loginUrl } = await api.impersonate(ownerUserId.trim() || '');
      window.open(loginUrl, '_blank', 'noopener');
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to create login link';
    } finally {
      openingOwner = false;
    }
  }
</script>

<div class="max-w-[480px]">
  <h1>Create organization</h1>
  <p class="text-muted mt-1 mb-6 text-[13px]">Creates an org and makes an existing user its admin.</p>

  {#if created}
    <div class="card flex flex-col items-start p-6">
      <span class="badge badge-success mb-2">Created</span>
      <h2 class="text-[18px]">{created.org.name}</h2>
      {#if created.org.siteName}
        <p class="mt-1 mb-4 text-[13px]">
          <a href={`https://${created.org.siteName}.classroom.io.vn`} target="_blank" rel="noopener">
            {created.org.siteName}.classroom.io.vn ↗
          </a>
        </p>
      {/if}
      <div class="flex gap-2">
        <button class="btn btn-primary" onclick={loginAsOwner} disabled={openingOwner}>
          {openingOwner ? 'Opening…' : 'Login as owner'}
        </button>
        <button class="btn" onclick={reset}>Create another</button>
      </div>
    </div>
  {:else}
    <form class="card p-6" onsubmit={onSubmit}>
      <label class="mb-4 block">
        <span class="text-muted mb-1 block text-[12px] font-medium">Organization name</span>
        <input class="input" bind:value={name} placeholder="MSNA Academy" required />
      </label>

      <label class="mb-4 block">
        <span class="text-muted mb-1 block text-[12px] font-medium">Site name (subdomain)</span>
        <input
          class="input"
          bind:value={siteName}
          placeholder="msna"
          required
          autocapitalize="off"
          autocomplete="off"
        />
        <p class="text-muted mt-1 text-[12px]">{siteHint}</p>
      </label>

      <label class="mb-4 block">
        <span class="text-muted mb-1 block text-[12px] font-medium">Owner user ID</span>
        <input
          class="input tabular"
          bind:value={ownerUserId}
          placeholder="00000000-0000-0000-0000-000000000000"
          required
        />
        <p class="text-muted mt-1 text-[12px]">
          The user becomes the org admin. Find the ID on the user's profile page.
        </p>
      </label>

      {#if error}<p class="error-text mb-3" role="alert">{error}</p>{/if}

      <button class="btn btn-primary w-full" type="submit" disabled={submitting || !name || !siteName || !ownerUserId}>
        {submitting ? 'Creating…' : 'Create organization'}
      </button>
    </form>
  {/if}
</div>
