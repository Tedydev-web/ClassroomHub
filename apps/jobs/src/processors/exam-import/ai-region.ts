import { createHash } from 'node:crypto';

import * as z from 'zod';

import { env } from '@cio/core/config/env';
import { assertAgentRunAdmitted } from '@cio/core/services/agent/gateway-run-admission';
import {
  readGatewayConnectionFromEnv,
  recordGatewayFailure,
  recordGatewaySuccess,
  selectGatewayModelId
} from '@cio/core/services/agent/gateway-runtime';
import { getGatewaySettings, getOrgGatewayLimits } from '@cio/core/services/agent/gateway-settings-store';
import { getOrganizationById } from '@cio/db/queries/organization';
import {
  collectExamImportAiRegions,
  examImportAiRegionResponseSchema,
  type ExamImportAiRegion,
  type ExamImportAiRegionResponse
} from '@cio/exam-import/draft/exam-import-ai-regions';
import type { ExamImportDraft } from '@cio/exam-import/draft/exam-import-draft';

import { acquireExamImportAiLease } from './ai-lease';

const REQUEST_TIMEOUT_MS = 60_000;
const TOOL_NAME = 'submit_exam_import_region';

const gatewayResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          tool_calls: z
            .array(
              z.object({
                function: z.object({
                  name: z.literal(TOOL_NAME),
                  arguments: z.string()
                })
              })
            )
            .length(1)
        })
      })
    )
    .length(1)
});

const gatewayUsageSchema = z.object({
  usage: z
    .object({
      prompt_tokens: z.number().int().min(0),
      completion_tokens: z.number().int().min(0)
    })
    .optional()
});

function gatewayUsage(value: unknown): { promptTokens: number; completionTokens: number } {
  const parsed = gatewayUsageSchema.safeParse(value);

  return {
    promptTokens: parsed.success ? (parsed.data.usage?.prompt_tokens ?? 0) : 0,
    completionTokens: parsed.success ? (parsed.data.usage?.completion_tokens ?? 0) : 0
  };
}

export type ExamImportAiRegionCall =
  | { kind: 'disabled' }
  | { kind: 'waiting' }
  | {
      kind: 'attempted';
      region: ExamImportAiRegion;
      response: ExamImportAiRegionResponse | null;
      requestHash: string;
      sentAt: string;
      model: string;
      quotaMultiplier: number;
      promptTokens: number;
      completionTokens: number;
      transportAvailable: boolean;
    };

function chatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/u, '');

  return normalized.endsWith('/v1') ? `${normalized}/chat/completions` : `${normalized}/v1/chat/completions`;
}

function requestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function parseRegionResponse(argumentsJson: string): ExamImportAiRegionResponse | null {
  try {
    const parsedJson: unknown = JSON.parse(argumentsJson);
    const parsed = examImportAiRegionResponseSchema.safeParse(parsedJson);

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function aiEnabledForOrganization(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false;

  const examImport = (settings as Record<string, unknown>).examImport;
  if (!examImport || typeof examImport !== 'object' || Array.isArray(examImport)) return false;

  return (examImport as Record<string, unknown>).aiEnabled === true;
}

export async function requestNextExamImportAiRegion(input: {
  draft: ExamImportDraft;
  organizationId: string;
  auditedQuestionIds: ReadonlySet<string>;
  questionId?: string;
}): Promise<ExamImportAiRegionCall> {
  if (env.EXAM_IMPORT_AI_ENABLED !== 'true') return { kind: 'disabled' };

  const organization = await getOrganizationById(input.organizationId);
  if (!organization || !aiEnabledForOrganization(organization.settings)) return { kind: 'disabled' };

  const region = collectExamImportAiRegions(input.draft).find((candidate) =>
    input.questionId ? candidate.questionId === input.questionId : !input.auditedQuestionIds.has(candidate.questionId)
  );
  if (!region) return { kind: 'disabled' };

  const admission = await assertAgentRunAdmitted({
    orgId: input.organizationId,
    hasOfficialKey: false
  });
  if (!admission.admitted) return { kind: 'waiting' };

  const settings = await getGatewaySettings();
  const organizationLimits = await getOrgGatewayLimits(input.organizationId);
  const connection = readGatewayConnectionFromEnv();
  const requestedModel = env.EXAM_IMPORT_AI_MODEL?.trim();
  const model = requestedModel ? selectGatewayModelId(settings, requestedModel) : null;
  const modelConfig = settings.modelAllowlist.find((entry) => entry.modelId === model);
  if (!model || !modelConfig || !connection.baseURL || !connection.authToken) return { kind: 'disabled' };

  const lease = await acquireExamImportAiLease({
    organizationId: input.organizationId,
    globalLimit: settings.globalConcurrency,
    organizationLimit: organizationLimits.maxActiveRuns
  });
  if (!lease) return { kind: 'waiting' };

  const schema = z.toJSONSchema(examImportAiRegionResponseSchema);
  const requestBody = {
    model,
    messages: [
      {
        role: 'system',
        content:
          'Resolve only the supplied exam region. Preserve identifiers and provenance. Return exactly one region matching the supplied questionId. Never add unrequested questions.'
      },
      {
        role: 'user',
        content: JSON.stringify(region)
      }
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: TOOL_NAME,
          description: 'Submit the strictly validated resolution for the supplied exam region.',
          strict: true,
          parameters: schema
        }
      }
    ],
    tool_choice: {
      type: 'function',
      function: { name: TOOL_NAME }
    },
    temperature: 0,
    max_completion_tokens: 4_096
  };
  const sentAt = new Date().toISOString();
  const digest = requestHash(requestBody);

  try {
    const response = await fetch(chatCompletionsUrl(connection.baseURL), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.authToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) {
      await recordGatewayFailure({ status: response.status });

      return {
        kind: 'attempted',
        region,
        response: null,
        requestHash: digest,
        sentAt,
        model,
        quotaMultiplier: modelConfig.quotaWeight,
        promptTokens: 0,
        completionTokens: 0,
        transportAvailable: false
      };
    }

    const responseJson: unknown = await response.json();
    const usage = gatewayUsage(responseJson);
    const parsedGatewayResponse = gatewayResponseSchema.safeParse(responseJson);
    await recordGatewaySuccess();
    if (!parsedGatewayResponse.success) {
      return {
        kind: 'attempted',
        region,
        response: null,
        requestHash: digest,
        sentAt,
        model,
        quotaMultiplier: modelConfig.quotaWeight,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        transportAvailable: true
      };
    }

    const toolCall = parsedGatewayResponse.data.choices[0]!.message.tool_calls[0]!;

    return {
      kind: 'attempted',
      region,
      response: toolCall ? parseRegionResponse(toolCall.function.arguments) : null,
      requestHash: digest,
      sentAt,
      model,
      quotaMultiplier: modelConfig.quotaWeight,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      transportAvailable: true
    };
  } catch (error) {
    await recordGatewayFailure(error);

    return {
      kind: 'attempted',
      region,
      response: null,
      requestHash: digest,
      sentAt,
      model,
      quotaMultiplier: modelConfig.quotaWeight,
      promptTokens: 0,
      completionTokens: 0,
      transportAvailable: false
    };
  } finally {
    try {
      await lease.release();
    } catch (error) {
      console.error('requestNextExamImportAiRegion lease release error:', error);
    }
  }
}
