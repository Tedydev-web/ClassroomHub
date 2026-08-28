<script>
  import { page } from '$app/state';
  import { Button } from '@cio/ui/base/button';
  import { Empty } from '@cio/ui/custom/empty';
  import { ExternalLinkIcon, HomeIcon, HoverableItem } from '@cio/ui/custom/moving-icons';
  import HeartCrack from '@lucide/svelte/icons/heart-crack';
  import { PRODUCT_HOSTS } from '@cio/utils/constants';
  import { t } from '$lib/utils/functions/translations';
  import LanguagePicker from '$features/ui/language-picker.svelte';

  const isNotFound = $derived(page.status === 404);

  console.error('Error message:', page.error?.message);
  console.error('Error page:', page.url);

  function goHome() {
    window.location.href = `https://${PRODUCT_HOSTS.marketing}`;
  }
</script>

<svelte:head>
  <title>{isNotFound ? $t('error_page.not_found_title') : $t('error_page.unexpected_title')}</title>
</svelte:head>

<!--
  The page a lost visitor lands on is the worst one to be unable to read, and until now it
  was the only screen in the product hardcoded to English.
-->
<div class="fixed top-3 right-3 z-30">
  <LanguagePicker variant="outline" />
</div>

{#if isNotFound}
  <Empty
    title={$t('error_page.not_found_title')}
    description={$t('error_page.not_found_description')}
    icon={HeartCrack}
    variant="page"
    layout="full-page"
    showLogo={true}
  >
    <div class="flex gap-2">
      <HoverableItem>
        {#snippet children(isHovered)}
          <Button onclick={goHome}>
            <HomeIcon {isHovered} size={16} ariaHidden={true} />
            {$t('error_page.go_home')}
          </Button>
        {/snippet}
      </HoverableItem>
    </div>
  </Empty>
{:else}
  <Empty
    title={$t('error_page.unexpected_title')}
    description={$t('error_page.unexpected_description')}
    icon={HeartCrack}
    variant="page"
    layout="full-page"
    showLogo={true}
  >
    <div class="flex gap-2">
      <HoverableItem>
        {#snippet children(isHovered)}
          <Button href={`https://${PRODUCT_HOSTS.marketing}`} variant="secondary">
            <ExternalLinkIcon {isHovered} size={16} ariaHidden={true} />
            {$t('error_page.try_free_tools')}
          </Button>
        {/snippet}
      </HoverableItem>
      <HoverableItem>
        {#snippet children(isHovered)}
          <Button onclick={goHome}>
            <HomeIcon {isHovered} size={16} ariaHidden={true} />
            {$t('error_page.go_home')}
          </Button>
        {/snippet}
      </HoverableItem>
    </div>
  </Empty>
{/if}
