import type { TAgentCreditPurchase } from '@cio/utils/validation/agent';

import { classroomhub, type InferResponseType } from '$lib/utils/services/api';
import { getApiKeyHeaders, safeServerApi } from '$lib/utils/services/api/server';

type RecordPurchaseRequest = typeof classroomhub.agent.credits.purchase.$post;
type RecordPurchaseSuccess = Extract<InferResponseType<RecordPurchaseRequest>, { success: true }>;

export class CreditPurchaseApiServer {
  /**
   * Record a token-pack purchase from the Polar webhook (server-side, API key auth).
   */
  static async recordPurchase(params: TAgentCreditPurchase) {
    const result = await safeServerApi<RecordPurchaseSuccess>(() =>
      classroomhub.agent.credits.purchase.$post({ json: params }, getApiKeyHeaders())
    );

    if (!result.ok) {
      console.error('Error recording credit purchase (server):', result);
      return null;
    }

    return result.body.data;
  }
}
