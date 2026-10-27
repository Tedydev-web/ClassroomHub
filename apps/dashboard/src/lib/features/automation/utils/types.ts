import { classroomhub, type InferResponseType } from '$lib/utils/services/api';

export type ListAutomationKeysRequest = (typeof classroomhub.organization)['automation']['keys']['$get'];
export type GetAutomationUsageRequest = (typeof classroomhub.organization)['automation']['usage']['$get'];
export type CreateAutomationKeyRequest = (typeof classroomhub.organization)['automation']['keys']['$post'];
export type RevokeAutomationKeyRequest = (typeof classroomhub.organization)['automation']['keys'][':keyId']['$delete'];
export type RotateAutomationKeyRequest =
  (typeof classroomhub.organization)['automation']['keys'][':keyId']['rotate']['$post'];

export type ListAutomationKeysSuccess = Extract<InferResponseType<ListAutomationKeysRequest>, { success: true }>;
export type GetAutomationUsageSuccess = Extract<InferResponseType<GetAutomationUsageRequest>, { success: true }>;
export type CreateAutomationKeySuccess = Extract<InferResponseType<CreateAutomationKeyRequest>, { success: true }>;
export type RevokeAutomationKeySuccess = Extract<InferResponseType<RevokeAutomationKeyRequest>, { success: true }>;
export type RotateAutomationKeySuccess = Extract<InferResponseType<RotateAutomationKeyRequest>, { success: true }>;

export type AutomationKey = ListAutomationKeysSuccess['data'][number];
export type AutomationKeyType = AutomationKey['type'];
export type AutomationUsage = GetAutomationUsageSuccess['data'];

export type ListWebhooksRequest = (typeof classroomhub.organization)['webhooks']['$get'];
export type CreateWebhookRequest = (typeof classroomhub.organization)['webhooks']['$post'];
export type UpdateWebhookRequest = (typeof classroomhub.organization)['webhooks'][':webhookId']['$put'];
export type DeleteWebhookRequest = (typeof classroomhub.organization)['webhooks'][':webhookId']['$delete'];
export type RegenerateWebhookSecretRequest =
  (typeof classroomhub.organization)['webhooks'][':webhookId']['secret']['$post'];
export type SendTestWebhookRequest = (typeof classroomhub.organization)['webhooks'][':webhookId']['test']['$post'];
export type ListWebhookDeliveriesRequest =
  (typeof classroomhub.organization)['webhooks'][':webhookId']['deliveries']['$get'];
export type GetWebhookDeliveryRequest =
  (typeof classroomhub.organization)['webhooks'][':webhookId']['deliveries'][':deliveryId']['$get'];
export type RedeliverWebhookRequest =
  (typeof classroomhub.organization)['webhooks'][':webhookId']['deliveries'][':deliveryId']['redeliver']['$post'];

export type ListWebhooksSuccess = Extract<InferResponseType<ListWebhooksRequest>, { success: true }>;
export type CreateWebhookSuccess = Extract<InferResponseType<CreateWebhookRequest>, { success: true }>;
export type ListWebhookDeliveriesSuccess = Extract<InferResponseType<ListWebhookDeliveriesRequest>, { success: true }>;
export type GetWebhookDeliverySuccess = Extract<InferResponseType<GetWebhookDeliveryRequest>, { success: true }>;

export type Webhook = ListWebhooksSuccess['data'][number];
export type WebhookHealth = Webhook['health'];
export type WebhookEventMode = Webhook['eventMode'];
export type WebhookDeliverySummary = ListWebhookDeliveriesSuccess['data'][number];
export type WebhookDeliveryStatus = WebhookDeliverySummary['status'];
export type WebhookDeliveryPagination = ListWebhookDeliveriesSuccess['pagination'];
export type WebhookDeliveryDetail = GetWebhookDeliverySuccess['data'];

export type WebhookFormFields = {
  name: string;
  payloadUrl: string;
  secret: string;
  verifySsl: boolean;
  eventMode: WebhookEventMode;
  eventTypes: string[];
  isActive: boolean;
};
