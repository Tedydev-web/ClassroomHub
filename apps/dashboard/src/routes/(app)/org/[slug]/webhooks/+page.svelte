<script lang="ts">
  import { PRODUCT_NAME } from '@cio/utils/constants';
  import { WebhooksAutomationPage } from '$features/automation/pages';
  import { t } from '$lib/utils/functions/translations';
  import * as Page from '@cio/ui/base/page';
</script>

<svelte:head><title>{t.get('automation.tabs.webhooks')} - {PRODUCT_NAME}</title></svelte:head>

<Page.Root class="mx-auto w-full max-w-5xl">
  <Page.Header>
    <Page.HeaderContent>
      <Page.Title>{$t('automation.tabs.webhooks')}</Page.Title>
      <Page.Subtitle>{$t('automation.webhooks.subtitle')}</Page.Subtitle>
    </Page.HeaderContent>
  </Page.Header>
  <Page.Body>{#snippet child()}<WebhooksAutomationPage />{/snippet}</Page.Body>
</Page.Root>
