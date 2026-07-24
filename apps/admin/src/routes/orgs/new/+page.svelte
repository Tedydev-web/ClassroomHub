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

<div class="wrap">
  <h1>Create organization</h1>
  <p class="sub">Creates an org and makes an existing user its admin.</p>

  {#if created}
    <div class="card success-card">
      <span class="badge badge-success" style="margin-bottom:var(--sp-2)">Created</span>
      <h2>{created.org.name}</h2>
      {#if created.org.siteName}
        <p class="site">
          <a href={`https://${created.org.siteName}.classroom.io.vn`} target="_blank" rel="noopener">
            {created.org.siteName}.classroom.io.vn ↗
          </a>
        </p>
      {/if}
      <div class="success-actions">
        <button class="btn btn-primary" onclick={loginAsOwner} disabled={openingOwner}>
          {openingOwner ? 'Opening…' : 'Login as owner'}
        </button>
        <button class="btn" onclick={reset}>Create another</button>
      </div>
    </div>
  {:else}
    <form class="card form" onsubmit={onSubmit}>
      <label class="field">
        <span>Organization name</span>
        <input class="input" bind:value={name} placeholder="MSNA Academy" required />
      </label>

      <label class="field">
        <span>Site name (subdomain)</span>
        <input
          class="input"
          bind:value={siteName}
          placeholder="msna"
          required
          autocapitalize="off"
          autocomplete="off"
        />
        <p class="hint">{siteHint}</p>
      </label>

      <label class="field">
        <span>Owner user ID</span>
        <input
          class="input tabular"
          bind:value={ownerUserId}
          placeholder="00000000-0000-0000-0000-000000000000"
          required
        />
        <p class="hint">The user becomes the org admin. Find the ID on the user's profile page.</p>
      </label>

      {#if error}<p class="error-text" role="alert" style="margin-bottom:var(--sp-3)">{error}</p>{/if}

      <button class="btn btn-primary" type="submit" disabled={submitting || !name || !siteName || !ownerUserId}>
        {submitting ? 'Creating…' : 'Create organization'}
      </button>
    </form>
  {/if}
</div>

<style>
  .wrap {
    max-width: 480px;
  }
  .sub {
    margin: 4px 0 var(--sp-5);
    color: var(--muted);
    font-size: 13px;
  }
  .form {
    padding: var(--sp-5);
  }
  .form .btn-primary {
    width: 100%;
  }
  .success-card {
    padding: var(--sp-5);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }
  .success-card h2 {
    font-size: 18px;
  }
  .site {
    margin: var(--sp-1) 0 var(--sp-4);
    font-size: 13px;
  }
  .success-actions {
    display: flex;
    gap: var(--sp-2);
  }
</style>
