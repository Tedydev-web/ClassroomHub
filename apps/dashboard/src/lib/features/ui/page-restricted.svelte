<script>
  import { Button } from '@cio/ui/base/button';
  import LockIcon from '@lucide/svelte/icons/lock';
  import { Empty } from '@cio/ui/custom/empty';
  import { PRODUCT_HOSTS } from '@cio/utils/constants';
  import { t } from '$lib/utils/functions/translations';
</script>

<div class="flex h-screen w-screen flex-col items-center justify-center">
  <Empty
    title={$t('common.restricted_page.title')}
    description={$t('common.restricted_page.description')}
    icon={LockIcon}
    variant="page"
    layout="full-page"
    showLogo={true}
  >
    <Button href={`https://${PRODUCT_HOSTS.marketing}`}>{$t('common.restricted_page.home')}</Button>
  </Empty>
</div>
