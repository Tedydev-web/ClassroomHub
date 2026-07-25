<script lang="ts">
  import { currentOrg } from '$lib/utils/store/org';
  import { BRAND_ROOT_DOMAIN, TENANT_ROOT_DOMAIN } from '@cio/utils/constants';

  const utmSource = $derived(
    $currentOrg.customDomain ||
      ($currentOrg.siteName ? `${$currentOrg.siteName}.${TENANT_ROOT_DOMAIN}` : BRAND_ROOT_DOMAIN)
  );
</script>

<!--
  Brand link, placed straight in the sidebar header rather than a MenuButton so
  the wordmark is sized on its own terms instead of a menu-row height. Responsive
  by state: the full wordmark shows while the sidebar is expanded (desktop) or in
  the mobile off-canvas sheet, and swaps to the square mark on the desktop icon
  rail (~3rem), where a 3.88:1 wordmark could not read. `max-w-full` keeps the
  wordmark inside the rail at any width.
-->
<a
  href="https://{BRAND_ROOT_DOMAIN}?utm_source={utmSource}"
  target="_blank"
  rel="noopener noreferrer"
  aria-label="ClassroomHub"
  class="flex items-center rounded-md p-1 transition-opacity group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0 hover:opacity-90"
>
  <img
    src="/wordmark.svg"
    alt="ClassroomHub"
    class="h-12 w-auto max-w-full shrink-0 object-contain object-left group-data-[collapsible=icon]:hidden"
  />
  <img
    src="/logo-192.svg"
    alt=""
    aria-hidden="true"
    class="hidden size-8 shrink-0 object-contain group-data-[collapsible=icon]:block"
  />
</a>
