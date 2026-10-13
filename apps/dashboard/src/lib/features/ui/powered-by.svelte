<script lang="ts">
  import { PublicCoursePoweredBy } from '@cio/ui/custom/public-course';
  import { PRODUCT_HOSTS, PRODUCT_NAME, TENANT_ROOT_DOMAIN } from '@cio/utils/constants';
  import { t } from '$lib/utils/functions/translations';
  import { currentOrg, isFreePlan } from '$lib/utils/store/org';
  import { cn } from '@cio/ui/tools';

  type Props = {
    /** Floating promo chip (landing / marketing) vs subdued sidebar attribution. */
    variant?: 'floating' | 'sidebar';
    class?: string;
    /** Sidebar: logo only when rail is collapsed. */
    showOnlyLogo?: boolean;
    /** Passed as utm_content for sidebar attribution. */
    courseSlug?: string | null;
    orgSlug?: string | null;
    /** Sidebar: utm_source override (default distinguishes LMS attribution). */
    sidebarUtmSource?: string;
  };

  let {
    variant = 'floating',
    class: className,
    showOnlyLogo = false,
    courseSlug = null,
    orgSlug = null,
    sidebarUtmSource = 'lms-sidebar'
  }: Props = $props();

  const attributionOrgSlug = $derived(orgSlug ?? $currentOrg.siteName ?? null);
</script>

{#if variant === 'sidebar'}
  <PublicCoursePoweredBy
    {courseSlug}
    orgSlug={attributionOrgSlug}
    utmSource={sidebarUtmSource}
    label={$t('public_course.powered_by.label')}
    compact={showOnlyLogo}
    align={showOnlyLogo ? 'center' : 'start'}
    class={className}
  />
{:else if $isFreePlan}
  <a
    href={`https://${PRODUCT_HOSTS.marketing}?utm_source=${$currentOrg.siteName}.${TENANT_ROOT_DOMAIN}`}
    target="_blank"
    class={cn('group fixed right-9 bottom-14 z-50 hover:no-underline', className)}
  >
    <span
      class={cn(
        'relative flex items-center gap-1 overflow-hidden rounded-md border border-gray-100 bg-white text-sm font-medium text-black shadow-sm transition duration-500 group-hover:border-blue-600 dark:border-neutral-700 dark:bg-white',

        showOnlyLogo ? 'border-none p-0' : 'border px-2 py-1'
      )}
    >
      {#if !showOnlyLogo}
        {$t('course.navItem.landing_page.powered_by')}
      {/if}
      <img src="/wordmark.svg" alt={PRODUCT_NAME} class="h-9 w-auto" />
    </span>
  </a>
{/if}
