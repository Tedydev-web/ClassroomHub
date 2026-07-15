import type {
  CreateWebhookRequest,
  CreateWebhookPayload,
  DeleteWebhookRequest,
  ListWebhookDeliveriesRequest,
  ListWebhooksRequest,
  RedeliverWebhookRequest,
  TestWebhookRequest,
  UpdateWebhookRequest,
  UpdateWebhookPayload,
  WebhookDelivery,
  WebhookEndpoint
} from '$features/automation/utils/types';
import { BaseApiWithErrors, classroomio } from '$lib/utils/services/api';
import { snackbar } from '$features/ui/snackbar/store';

class WebhooksApi extends BaseApiWithErrors {
  deliveries = $state<WebhookDelivery[]>([]);
  endpoints = $state<WebhookEndpoint[]>([]);
  generatedSecret = $state<string | null>(null);

  async list() {
    return this.execute<ListWebhooksRequest>({
      requestFn: () => classroomio.organization.webhooks.$get(),
      logContext: 'fetching webhooks',
      onSuccess: (response) => {
        this.endpoints = response.data;
      }
    });
  }

  async create(json: CreateWebhookPayload) {
    return this.execute<CreateWebhookRequest>({
      requestFn: () => classroomio.organization.webhooks.$post({ json }),
      logContext: 'creating webhook',
      onSuccess: (response) => {
        const { secret, ...endpoint } = response.data;
        this.generatedSecret = secret;
        this.endpoints = [endpoint, ...this.endpoints];
        snackbar.success('snackbar.webhooks.saved');
      }
    });
  }

  async update(webhookId: string, json: UpdateWebhookPayload) {
    return this.execute<UpdateWebhookRequest>({
      requestFn: () => classroomio.organization.webhooks[':webhookId'].$put({ json, param: { webhookId } }),
      logContext: 'updating webhook',
      onSuccess: (response) => {
        this.endpoints = this.endpoints.map((endpoint) => (endpoint.id === webhookId ? response.data : endpoint));
        snackbar.success('snackbar.webhooks.saved');
      }
    });
  }

  async remove(webhookId: string) {
    return this.execute<DeleteWebhookRequest>({
      requestFn: () => classroomio.organization.webhooks[':webhookId'].$delete({ param: { webhookId } }),
      logContext: 'deleting webhook',
      onSuccess: () => {
        this.endpoints = this.endpoints.filter((endpoint) => endpoint.id !== webhookId);
        snackbar.success('snackbar.webhooks.deleted');
      }
    });
  }

  async sendTest(webhookId: string) {
    return this.execute<TestWebhookRequest>({
      requestFn: () => classroomio.organization.webhooks[':webhookId'].test.$post({ param: { webhookId } }),
      logContext: 'sending webhook test',
      onSuccess: () => snackbar.success('snackbar.webhooks.test_queued')
    });
  }

  async listDeliveries(webhookId: string) {
    return this.execute<ListWebhookDeliveriesRequest>({
      requestFn: () =>
        classroomio.organization.webhooks[':webhookId'].deliveries.$get({
          param: { webhookId },
          query: { limit: '20', page: '1' }
        }),
      logContext: 'fetching webhook deliveries',
      onSuccess: (response) => {
        this.deliveries = response.data.items;
      }
    });
  }

  async redeliver(webhookId: string, deliveryId: string) {
    return this.execute<RedeliverWebhookRequest>({
      requestFn: () =>
        classroomio.organization.webhooks[':webhookId'].deliveries[':deliveryId'].redeliver.$post({
          param: { deliveryId, webhookId }
        }),
      logContext: 'redelivering webhook',
      onSuccess: (response) => {
        this.deliveries = this.deliveries.map((item) =>
          item.delivery.id === deliveryId ? { ...item, delivery: response.data } : item
        );
        snackbar.success('snackbar.webhooks.redelivery_queued');
      }
    });
  }
}

export const webhooksApi = new WebhooksApi();
