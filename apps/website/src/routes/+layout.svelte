<script lang="ts">
  import { dev } from '$app/environment';
  import { page } from '$app/state';
  import { Footer, Navigation, NotFound } from '$lib/components';
  import { applyGeoLocale } from '$lib/i18n/geo-locale';
  import { initUserJot } from '$lib/utils/userjot';
  import extend from 'just-extend';
  import { onMount } from 'svelte';
  import { MetaTags } from 'svelte-meta-tags';

  import '../app.css';

  let { children, data } = $props();

  onMount(() => {
    void applyGeoLocale(page.url.pathname);

    if (dev) {
      localStorage.setItem('umami.disabled', '1');
      return;
    }

    initUserJot();
  });

  let metaTags = $derived(extend(true, {}, data.baseMetaTags, page.data.pageMetaTags));
</script>

<MetaTags {...metaTags} />

<div class="overflow-hidden bg-white">
  <Navigation />

  {#if page.status === 404}
    <NotFound className="mt-5" />
  {:else}
    {@render children?.()}
  {/if}

  <Footer />
</div>
