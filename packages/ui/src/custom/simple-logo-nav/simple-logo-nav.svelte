<script lang="ts">
  import { PRODUCT_HOSTS } from '@cio/utils/constants';
  import { cn } from '../../tools';

  interface Props {
    tagline?: string;
    class?: string;
  }

  let { tagline = 'One Platform for Customer, Partner, and Employee Training', class: className }: Props = $props();
</script>

<div
  class={cn(
    'ui:absolute ui:top-2 ui:flex ui:flex-col ui:items-center ui:rounded-md ui:border ui:border-dashed ui:px-4 ui:py-1',
    className
  )}
>
  <a
    href={`https://${PRODUCT_HOSTS.marketing}`}
    target="_blank"
    rel="noopener noreferrer"
    class="ui:flex ui:items-center ui:justify-center"
  >
    <img src="/wordmark.svg" class="ui:h-12 ui:w-auto" alt="ClassroomHub" />
  </a>

  <p class="ui:text-muted-foreground ui:text-sm">{tagline}</p>
</div>
