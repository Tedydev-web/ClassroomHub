<script>
  import { Label } from '@cio/ui/base/label';
  import { Switch } from '@cio/ui/base/switch';

  import { issueCertificateModal, resetForm } from './store';
  import { preventDefault } from '$lib/utils/functions/svelte';

  import * as Dialog from '@cio/ui/base/dialog';
  import { TextareaField } from '@cio/ui/custom/textarea-field';
  import { InputField } from '@cio/ui/custom/input-field';
  import { Button } from '@cio/ui/base/button';
  import { t } from '$lib/utils/functions/translations';

  let isAutomatic = $state(false);

  const issueCertificate = () => {
    resetForm();
  };
</script>

<Dialog.Root
  bind:open={$issueCertificateModal.open}
  onOpenChange={(isOpen) => {
    if (!isOpen) resetForm();
  }}
>
  <Dialog.Content class="w-3/5">
    <Dialog.Header>
      <Dialog.Title>{$t('course.navItem.certificates.issue_modal.title')}</Dialog.Title>
    </Dialog.Header>
    <main>
      <div>
        <div class="mb-4 flex items-center space-x-2">
          <Switch id="auto-certificate" bind:checked={isAutomatic} />
          <Label for="auto-certificate" class="text-sm font-medium"
            >{$t('course.navItem.certificates.issue_modal.automatic')}</Label
          >
        </div>
        <p class="my-4 text-sm font-medium">
          {$t('course.navItem.certificates.issue_modal.automatic_hint')}
        </p>
      </div>
      <p class="ui:text-muted-foreground my-4 text-xs font-normal">
        {$t('course.navItem.certificates.issue_modal.custom_intro')}
      </p>
      <form onsubmit={preventDefault(issueCertificate)}>
        <div class="flex w-full flex-col gap-2 md:flex-row">
          <InputField
            label={$t('course.navItem.certificates.issue_modal.student_email')}
            className="w-full my-4"
            labelClassName="text-xs font-normal"
            placeholder="email,comma seperated"
            bind:value={$issueCertificateModal.email}
          />
          <InputField
            label={$t('course.navItem.certificates.issue_modal.schedule_date')}
            className="w-full my-4"
            labelClassName="text-xs font-normal"
            placeholder="12/06/2023"
            bind:value={$issueCertificateModal.date}
          />
        </div>

        <TextareaField
          label={$t('course.navItem.certificates.issue_modal.personal_message')}
          labelClassName="text-xs font-normal"
          bind:value={$issueCertificateModal.message}
          rows={2}
          placeholder="your message here"
          className="mb-4"
        />

        <div class="mt-5 flex w-full items-end justify-end">
          <Button type="submit">{$t('course.navItem.certificates.issue_modal.submit')}</Button>
        </div>
      </form>
    </main>
  </Dialog.Content>
</Dialog.Root>
