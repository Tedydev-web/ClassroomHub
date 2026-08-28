<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';

  import { appInitApi } from '$features/app/init.svelte';
  import { Spinner } from '@cio/ui/base/spinner';
  import { Button } from '@cio/ui/base/button';
  import FrownIcon from '@lucide/svelte/icons/frown';
  import { Empty } from '@cio/ui/custom/empty';
  import { SimpleLogoNav } from '@cio/ui/custom/simple-logo-nav';
  import { buildOrgLandingPageProps, normalizeLandingPageSettings } from '$features/org/utils/landing-page';
  import { basePath } from '$lib/utils/store/app';
  import { t } from '$lib/utils/functions/translations';
  import LanguagePicker from '$features/ui/language-picker.svelte';
  import { user } from '$lib/utils/store/user';
  import { OPERATOR_EMAIL, PRODUCT_NAME } from '@cio/utils/constants';

  let { data } = $props();

  const hasSetupError = $derived(!appInitApi.loading && !!appInitApi.error);

  const pageTitle = $derived(
    data.isOrgSite && data.org
      ? data.org.name
      : `${PRODUCT_NAME} - One Platform for Customer, Partner, and Employee Training`
  );

  const authAction = $derived(
    $user.isLoggedIn
      ? {
          label: t.get($basePath === '/lms' || $basePath === '#' ? 'navigation.goto_lms' : 'navigation.goto_dashboard'),
          href: resolve($basePath !== '#' ? $basePath : '/lms', {})
        }
      : {
          label: t.get('navigation.login'),
          href: '/login'
        }
  );

  const landingPageProps = $derived.by(() => {
    if (!data.isOrgSite || !data.org) return null;

    return buildOrgLandingPageProps(
      data.org,
      normalizeLandingPageSettings(data.org.landingpage),
      data.courses,
      data.hasMoreCourses,
      authAction
    );
  });

  onMount(() => {
    if (!data.isOrgSite || !data.org) {
      if (!appInitApi.loading) {
        appInitApi.setupApp(data.locals, {
          isOrgSite: data.isOrgSite,
          orgSiteName: data.orgSiteName
        });
      }
    }
  });
</script>

<svelte:head>
  <title>{pageTitle}</title>
</svelte:head>

<!--
  The organisation's own landing page renders a theme component that knows nothing about
  this, so the switcher is floated over it here — the same corner every other chrome-less
  public page uses.
-->
<div class="fixed top-3 right-3 z-30">
  <LanguagePicker variant="outline" />
</div>

{#if data.isOrgSite && data.org}
  {#if data.ThemeComponent && landingPageProps}
    <svelte:component this={data.ThemeComponent} {...landingPageProps} />
  {/if}
{:else if hasSetupError}
  <Empty
    title={$t('error_page.setup_failed_title')}
    description={$t('error_page.setup_failed_description')}
    icon={FrownIcon}
    variant="page"
    layout="full-page"
    showLogo={true}
  >
    <p class="my-2 text-red-500">{appInitApi.error}</p>
    <div class="flex gap-2">
      <Button variant="secondary" onclick={() => window.location.reload()}>{$t('error_page.reload_page')}</Button>
      <Button variant="default" href={`mailto:${OPERATOR_EMAIL}`}>{$t('error_page.contact_us')}</Button>
    </div>
  </Empty>
{:else}
  <div class="m-2 flex h-screen w-screen flex-col items-center justify-center font-sans sm:m-0">
    <SimpleLogoNav />
    <Spinner class="size-14! text-blue-700!" />
  </div>
{/if}
