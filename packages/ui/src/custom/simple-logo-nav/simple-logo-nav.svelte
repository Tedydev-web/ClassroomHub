<script lang="ts">
  import { PRODUCT_HOSTS, PRODUCT_NAME } from '@cio/utils/constants';
</script>

<div
  class="ui:absolute ui:top-2 ui:border ui:border-dashed ui:px-4 ui:py-1 ui:rounded-md ui:flex ui:items-center ui:flex-col"
>
  <a
    href={`https://${PRODUCT_HOSTS.marketing}`}
    target="_blank"
    rel="noopener noreferrer"
    class="ui:flex ui:items-center ui:justify-center ui:gap-2"
  >
    <img src="/logo-512.png" class="ui:w-7 ui:h-7" alt={`${PRODUCT_NAME} Logo`} />
    <span class="ui:text-foreground ui:text-md">{PRODUCT_NAME}</span>
  </a>

  <p class="ui:text-muted-foreground ui:text-sm">One Platform for Customer, Partner, and Employee Training</p>
</div>
