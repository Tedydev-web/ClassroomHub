import { classroomhub, type InferRequestType, type InferResponseType } from '$lib/utils/services/api';

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
export type TestWebhookRequest = (typeof classroomhub.organization)['webhooks'][':webhookId']['test']['$post'];
export type ListWebhookDeliveriesRequest =
  (typeof classroomhub.organization)['webhooks'][':webhookId']['deliveries']['$get'];
export type RedeliverWebhookRequest =
  (typeof classroomhub.organization)['webhooks'][':webhookId']['deliveries'][':deliveryId']['redeliver']['$post'];

export type ListWebhooksSuccess = Extract<InferResponseType<ListWebhooksRequest>, { success: true }>;
export type WebhookEndpoint = ListWebhooksSuccess['data'][number];
export type ListWebhookDeliveriesSuccess = Extract<InferResponseType<ListWebhookDeliveriesRequest>, { success: true }>;
export type WebhookDelivery = ListWebhookDeliveriesSuccess['data']['items'][number];
export type CreateWebhookPayload = InferRequestType<CreateWebhookRequest>['json'];
export type UpdateWebhookPayload = InferRequestType<UpdateWebhookRequest>['json'];
