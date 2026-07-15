<script lang="ts">
  import { PRODUCT_NAME } from '@cio/utils/constants';
  import * as Page from '@cio/ui/base/page';
  import ScormPage from '$features/scorm/pages/scorm.svelte';
  import { t } from '$lib/utils/functions/translations';
</script>

<svelte:head><title>{t.get('scorm.title')} - {PRODUCT_NAME}</title></svelte:head>

<Page.Root class="mx-auto w-full max-w-6xl">
  <Page.Header>
    <Page.HeaderContent>
      <Page.Title>{$t('scorm.title')}</Page.Title>
      <Page.Subtitle>{$t('scorm.subtitle')}</Page.Subtitle>
    </Page.HeaderContent>
  </Page.Header>
  <Page.Body>{#snippet child()}<ScormPage />{/snippet}</Page.Body>
</Page.Root>
