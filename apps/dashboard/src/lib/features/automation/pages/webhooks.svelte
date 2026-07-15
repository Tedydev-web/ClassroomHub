<script lang="ts">
  import { onMount } from 'svelte';
  import { WEBHOOK_EVENT_TYPES, type TWebhookEventType } from '@cio/utils/validation/webhook';
  import type { WebhookDelivery, WebhookEndpoint } from '$features/automation/utils/types';
  import { webhooksApi } from '$features/automation/api/webhooks.svelte';
  import { t } from '$lib/utils/functions/translations';
  import { Badge } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import { Checkbox } from '@cio/ui/base/checkbox';
  import * as Code from '@cio/ui/custom/code';
  import * as Dialog from '@cio/ui/base/dialog';
  import * as DropdownMenu from '@cio/ui/base/dropdown-menu';
  import * as Field from '@cio/ui/base/field';
  import * as Table from '@cio/ui/base/table';
  import { InputField } from '@cio/ui/custom/input-field';
  import { Switch } from '@cio/ui/base/switch';
  import { Empty } from '@cio/ui/custom/empty';
  import { IconButton } from '@cio/ui/custom/icon-button';
  import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import WebhookIcon from '@lucide/svelte/icons/webhook';

  let editingId = $state<string | null>(null);
  let deliveryWebhookId = $state<string | null>(null);
  let events = $state<TWebhookEventType[]>([]);
  let isActive = $state(true);
  let isDeliveriesOpen = $state(false);
  let isFormOpen = $state(false);
  let name = $state('');
  let payloadUrl = $state('');
  let selectedDelivery = $state<WebhookDelivery | null>(null);
  let secret = $state('');

  const isFormValid = $derived(name.trim().length > 0 && payloadUrl.trim().length > 0 && !webhooksApi.isLoading);

  onMount(() => void webhooksApi.list());

  function resetForm(endpoint?: WebhookEndpoint) {
    editingId = endpoint?.id ?? null;
    events = (endpoint?.events as TWebhookEventType[]) ?? [];
    isActive = endpoint?.isActive ?? true;
    name = endpoint?.name ?? '';
    payloadUrl = endpoint?.payloadUrl ?? '';
    secret = '';
    webhooksApi.resetErrors();
  }

  function openCreate() {
    resetForm();
    isFormOpen = true;
  }

  function openEdit(endpoint: WebhookEndpoint) {
    resetForm(endpoint);
    isFormOpen = true;
  }

  function toggleEvent(event: TWebhookEventType, checked: boolean) {
    events = checked ? [...events, event] : events.filter((item) => item !== event);
  }

  async function save() {
    const common = {
      events,
      isActive,
      name: name.trim(),
      payloadUrl: payloadUrl.trim(),
      verifySsl: true
    };
    const result = editingId
      ? await webhooksApi.update(editingId, { ...common, ...(secret ? { secret } : {}) })
      : await webhooksApi.create({ ...common, ...(secret ? { secret } : {}) });
    if (!result) return;

    isFormOpen = false;
    resetForm();
  }

  async function toggleActive(endpoint: WebhookEndpoint, checked: boolean) {
    await webhooksApi.update(endpoint.id, { isActive: checked });
  }

  async function remove(endpoint: WebhookEndpoint) {
    if (!confirm(t.get('automation.webhooks.delete_confirm'))) return;
    await webhooksApi.remove(endpoint.id);
  }

  async function sendTest(endpoint: WebhookEndpoint) {
    await webhooksApi.sendTest(endpoint.id);
  }

  async function showDeliveries(endpoint: WebhookEndpoint) {
    const result = await webhooksApi.listDeliveries(endpoint.id);
    if (!result) return;
    deliveryWebhookId = endpoint.id;
    selectedDelivery = null;
    isDeliveriesOpen = true;
  }

  async function redeliver(deliveryId: string) {
    if (!deliveryWebhookId) return;

    await webhooksApi.redeliver(deliveryWebhookId, deliveryId);
  }
</script>

<Field.Group class="mx-auto w-full space-y-4">
  <div class="flex items-center justify-between gap-3">
    <div>
      <p class="font-medium">{$t('automation.webhooks.endpoints_title')}</p>
      <p class="ui:text-muted-foreground text-sm">{$t('automation.webhooks.endpoints_description')}</p>
    </div>
    <IconButton onclick={openCreate} tooltip={$t('automation.webhooks.add')}>
      <PlusIcon size={16} />
    </IconButton>
  </div>

  {#if webhooksApi.generatedSecret}
    <div class="rounded border p-4">
      <p class="mb-2 text-sm font-medium">{$t('automation.webhooks.secret_once')}</p>
      <Code.Root code={webhooksApi.generatedSecret} hideLines={true} class="ui:break-all ui:text-xs">
        <Code.CopyButton />
      </Code.Root>
    </div>
  {/if}

  {#if webhooksApi.endpoints.length > 0}
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>{$t('automation.webhooks.name')}</Table.Head>
          <Table.Head>{$t('automation.webhooks.payload_url')}</Table.Head>
          <Table.Head>{$t('automation.webhooks.events')}</Table.Head>
          <Table.Head>{$t('automation.webhooks.active')}</Table.Head>
          <Table.Head class="w-10"></Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each webhooksApi.endpoints as endpoint (endpoint.id)}
          <Table.Row>
            <Table.Cell class="font-medium">{endpoint.name}</Table.Cell>
            <Table.Cell class="max-w-80 truncate text-sm">{endpoint.payloadUrl}</Table.Cell>
            <Table.Cell
              >{endpoint.events.length === 0
                ? $t('automation.webhooks.all_events')
                : endpoint.events.length}</Table.Cell
            >
            <Table.Cell>
              <Switch checked={endpoint.isActive} onCheckedChange={(checked) => toggleActive(endpoint, checked)} />
            </Table.Cell>
            <Table.Cell>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger class="inline-flex items-center justify-center">
                  <IconButton aria-label={$t('automation.webhooks.actions')}>
                    <EllipsisVerticalIcon size={16} />
                  </IconButton>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content align="end">
                  <DropdownMenu.Item onclick={() => openEdit(endpoint)}
                    >{$t('automation.webhooks.edit')}</DropdownMenu.Item
                  >
                  <DropdownMenu.Item onclick={() => sendTest(endpoint)}
                    >{$t('automation.webhooks.send_test')}</DropdownMenu.Item
                  >
                  <DropdownMenu.Item onclick={() => showDeliveries(endpoint)}
                    >{$t('automation.webhooks.deliveries')}</DropdownMenu.Item
                  >
                  <DropdownMenu.Item class="ui:text-destructive" onclick={() => remove(endpoint)}>
                    {$t('automation.webhooks.delete')}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  {:else if !webhooksApi.isLoading}
    <Empty
      title={$t('automation.webhooks.empty_title')}
      description={$t('automation.webhooks.empty_description')}
      icon={WebhookIcon}
      variant="page"
    >
      <Button onclick={openCreate}><PlusIcon size={16} />{$t('automation.webhooks.add')}</Button>
    </Empty>
  {/if}
</Field.Group>

<Dialog.Root bind:open={isFormOpen}>
  <Dialog.Content class="max-h-[85vh] max-w-2xl overflow-y-auto">
    <Dialog.Header>
      <Dialog.Title>{editingId ? $t('automation.webhooks.edit') : $t('automation.webhooks.add')}</Dialog.Title>
      <Dialog.Description>{$t('automation.webhooks.form_description')}</Dialog.Description>
    </Dialog.Header>
    <Field.Group>
      <InputField bind:value={name} label={$t('automation.webhooks.name')} isRequired />
      <InputField bind:value={payloadUrl} label={$t('automation.webhooks.payload_url')} type="url" isRequired />
      <InputField
        bind:value={secret}
        label={$t('automation.webhooks.secret')}
        type="password"
        helperMessage={editingId ? $t('automation.webhooks.secret_unchanged') : $t('automation.webhooks.secret_help')}
      />
      <Field.Field orientation="horizontal">
        <Switch bind:checked={isActive} />
        <Field.Label>{$t('automation.webhooks.active')}</Field.Label>
      </Field.Field>
      <Field.Set>
        <Field.Legend>{$t('automation.webhooks.events')}</Field.Legend>
        <Field.Description>{$t('automation.webhooks.events_help')}</Field.Description>
        <div class="grid gap-3 sm:grid-cols-2">
          {#each WEBHOOK_EVENT_TYPES as event (event)}
            <Field.Field orientation="horizontal">
              <Checkbox
                checked={events.includes(event)}
                onCheckedChange={(checked) => toggleEvent(event, checked === true)}
              />
              <Field.Label class="font-mono text-xs">{event}</Field.Label>
            </Field.Field>
          {/each}
        </div>
      </Field.Set>
    </Field.Group>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => (isFormOpen = false)}>{$t('automation.webhooks.cancel')}</Button>
      <Button onclick={save} loading={webhooksApi.isLoading} disabled={!isFormValid}
        >{$t('automation.webhooks.save')}</Button
      >
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={isDeliveriesOpen}>
  <Dialog.Content class="max-w-3xl">
    <Dialog.Header>
      <Dialog.Title>{$t('automation.webhooks.deliveries')}</Dialog.Title>
    </Dialog.Header>
    {#if webhooksApi.deliveries.length > 0}
      <Table.Root>
        <Table.Header
          ><Table.Row
            ><Table.Head>{$t('automation.webhooks.event')}</Table.Head><Table.Head
              >{$t('automation.webhooks.status')}</Table.Head
            ><Table.Head>{$t('automation.webhooks.attempt')}</Table.Head><Table.Head
              >{$t('automation.webhooks.http_status')}</Table.Head
            ><Table.Head class="w-20"></Table.Head></Table.Row
          ></Table.Header
        >
        <Table.Body>
          {#each webhooksApi.deliveries as item (item.delivery.id)}
            <Table.Row>
              <Table.Cell class="font-mono text-xs">{item.event.eventType}</Table.Cell>
              <Table.Cell
                ><Badge variant={item.delivery.status === 'SUCCESS' ? 'default' : 'secondary'}
                  >{item.delivery.status}</Badge
                ></Table.Cell
              >
              <Table.Cell>{item.delivery.attempt}</Table.Cell>
              <Table.Cell>{item.delivery.responseStatus ?? '-'}</Table.Cell>
              <Table.Cell>
                <div class="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onclick={() => (selectedDelivery = item)}
                    >{$t('automation.webhooks.details')}</Button
                  >
                  <IconButton onclick={() => redeliver(item.delivery.id)} tooltip={$t('automation.webhooks.redeliver')}>
                    <RefreshCwIcon size={16} />
                  </IconButton>
                </div>
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
      {#if selectedDelivery}
        <div class="mt-4 space-y-3 border-t pt-4">
          <p class="text-sm font-medium">{$t('automation.webhooks.request_payload')}</p>
          <Code.Root code={JSON.stringify(selectedDelivery.event.payload, null, 2)} hideLines={true}>
            <Code.CopyButton />
          </Code.Root>
          <p class="text-sm font-medium">{$t('automation.webhooks.response')}</p>
          <Code.Root
            code={selectedDelivery.delivery.responseBody ??
              selectedDelivery.delivery.errorMessage ??
              $t('automation.webhooks.no_response')}
            hideLines={true}
          >
            <Code.CopyButton />
          </Code.Root>
        </div>
      {/if}
    {:else}
      <p class="ui:text-muted-foreground py-8 text-center text-sm">{$t('automation.webhooks.no_deliveries')}</p>
    {/if}
  </Dialog.Content>
</Dialog.Root>
