<script lang="ts">
  import { PRODUCT_HOSTS } from '@cio/utils/constants';
</script>

<div
  class="ui:absolute ui:top-2 ui:border ui:border-dashed ui:px-4 ui:py-1 ui:rounded-md ui:flex ui:items-center ui:flex-col"
>
  <a
    href={`https://${PRODUCT_HOSTS.marketing}`}
    target="_blank"
    rel="noopener noreferrer"
    class="ui:flex ui:items-center ui:justify-center"
  >
    <img src="/wordmark.svg" class="ui:h-12 ui:w-auto" alt="ClassroomHub" />
  </a>

  <p class="ui:text-muted-foreground ui:text-sm">One Platform for Customer, Partner, and Employee Training</p>
</div>
