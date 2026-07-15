<script lang="ts">
  import { embedSenjaWidget } from '@cio/utils/senja';
  import { env } from '$env/dynamic/public';
  import { onMount } from 'svelte';

  interface Props {
    id?: string;
  }

  let { id = '' }: Props = $props();

  onMount(() => {
    if (env.PUBLIC_IS_SELF_OWNED === 'true') return;

    embedSenjaWidget(id);
  });
</script>

{#if env.PUBLIC_IS_SELF_OWNED !== 'true'}
  <div class="senja-embed" data-id={id} data-lazyload="false" data-spinner="false"></div>
{/if}
