<script lang="ts">
  import * as Sidebar from '@cio/ui/base/sidebar';
  import { currentOrg } from '$lib/utils/store/org';
  import { BRAND_ROOT_DOMAIN, TENANT_ROOT_DOMAIN } from '@cio/utils/constants';

  const utmSource = $derived(
    $currentOrg.customDomain ||
      ($currentOrg.siteName ? `${$currentOrg.siteName}.${TENANT_ROOT_DOMAIN}` : BRAND_ROOT_DOMAIN)
  );
</script>

<Sidebar.Menu>
  <Sidebar.MenuItem>
    <Sidebar.MenuButton
      size="sm"
      class="ui:data-[state=open]:bg-sidebar-accent ui:data-[state=open]:text-sidebar-accent-foreground"
    >
      {#snippet child({ props })}
        <a
          href="https://{BRAND_ROOT_DOMAIN}?utm_source={utmSource}"
          target="_blank"
          rel="noopener noreferrer"
          {...props}
        >
          <img src="/wordmark.svg" alt="ClassroomHub" class="h-9 w-auto max-w-44 object-contain" />
        </a>
      {/snippet}
    </Sidebar.MenuButton>
  </Sidebar.MenuItem>
</Sidebar.Menu>
