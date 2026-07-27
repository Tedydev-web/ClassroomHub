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
  scannedPdfPageTranscriptionSchema,
  type ScannedPdfPageTranscription
} from '@cio/exam-import/pdf/scanned-pdf-transcription';
import { SCANNED_PDF_RASTER_LIMITS } from '@cio/exam-import/pdf/read-scanned-pdf-page-rasters';

import { acquireExamImportAiLease } from './ai-lease';

const REQUEST_TIMEOUT_MS = 60_000;
const TOOL_NAME = 'submit_exam_page_transcription';
export const EXAM_IMPORT_VISION_CONTRACT_VERSION = 1;

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

export function getConfiguredExamImportVisionModel(): string | null {
  const model = env.EXAM_IMPORT_VISION_MODEL?.trim();

  return model || null;
}

export type ExamImportVisionCall =
  | {
      kind: 'disabled';
      reason:
        | 'global_disabled'
        | 'vision_disabled'
        | 'organization_disabled'
        | 'organization_vision_disabled'
        | 'model_unavailable'
        | 'gateway_unavailable';
    }
  | { kind: 'waiting' }
  | {
      kind: 'attempted';
      response: ScannedPdfPageTranscription | null;
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

function organizationAiSettings(settings: unknown): { aiEnabled: boolean; scanVisionEnabled: boolean } {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { aiEnabled: false, scanVisionEnabled: false };
  }

  const examImport = (settings as Record<string, unknown>).examImport;
  if (!examImport || typeof examImport !== 'object' || Array.isArray(examImport)) {
    return { aiEnabled: false, scanVisionEnabled: false };
  }

  const values = examImport as Record<string, unknown>;

  return {
    aiEnabled: values.aiEnabled === true,
    scanVisionEnabled: values.scanVisionEnabled === true
  };
}

function pageResponseSchema(pageIndex: number) {
  return scannedPdfPageTranscriptionSchema.extend({
    pageIndex: z.literal(pageIndex)
  });
}

function parsePageResponse(argumentsJson: string, pageIndex: number): ScannedPdfPageTranscription | null {
  try {
    const parsedJson: unknown = JSON.parse(argumentsJson);
    const parsed = pageResponseSchema(pageIndex).safeParse(parsedJson);

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function requestExamImportVisionPage(input: {
  organizationId: string;
  pageIndex: number;
  pngBytes: Uint8Array;
  model?: string;
  contractVersion?: typeof EXAM_IMPORT_VISION_CONTRACT_VERSION;
}): Promise<ExamImportVisionCall> {
  if (
    !Number.isSafeInteger(input.pageIndex) ||
    input.pageIndex < 0 ||
    input.pageIndex >= SCANNED_PDF_RASTER_LIMITS.pages
  ) {
    throw new RangeError('Exam import vision page index is outside the supported range');
  }
  if (input.pngBytes.byteLength === 0) {
    throw new RangeError('Exam import vision page image is empty');
  }

  if (env.EXAM_IMPORT_AI_ENABLED !== 'true') {
    return { kind: 'disabled', reason: 'global_disabled' };
  }
  if (env.EXAM_IMPORT_VISION_ENABLED !== 'true') {
    return { kind: 'disabled', reason: 'vision_disabled' };
  }

  const organization = await getOrganizationById(input.organizationId);
  const organizationSettings = organizationAiSettings(organization?.settings);
  if (!organization || !organizationSettings.aiEnabled) {
    return { kind: 'disabled', reason: 'organization_disabled' };
  }
  if (!organizationSettings.scanVisionEnabled) {
    return { kind: 'disabled', reason: 'organization_vision_disabled' };
  }

  const admission = await assertAgentRunAdmitted({
    orgId: input.organizationId,
    hasOfficialKey: false
  });
  if (!admission.admitted) return { kind: 'waiting' };

  const settings = await getGatewaySettings();
  const organizationLimits = await getOrgGatewayLimits(input.organizationId);
  const connection = readGatewayConnectionFromEnv();
  const requestedModel = input.model?.trim() || getConfiguredExamImportVisionModel();
  const model = requestedModel ? selectGatewayModelId(settings, requestedModel) : null;
  const modelConfig = settings.modelAllowlist.find((entry) => entry.modelId === model);
  if (!model || !modelConfig) return { kind: 'disabled', reason: 'model_unavailable' };
  if (!connection.baseURL || !connection.authToken) {
    return { kind: 'disabled', reason: 'gateway_unavailable' };
  }

  const lease = await acquireExamImportAiLease({
    organizationId: input.organizationId,
    globalLimit: settings.globalConcurrency,
    organizationLimit: organizationLimits.maxActiveRuns
  });
  if (!lease) return { kind: 'waiting' };

  const responseSchema = pageResponseSchema(input.pageIndex);
  const contractVersion = input.contractVersion ?? EXAM_IMPORT_VISION_CONTRACT_VERSION;
  const requestBody = {
    model,
    messages: [
      {
        role: 'system',
        content: `Exam transcription contract v${contractVersion}. Transcribe this exam page exactly. Preserve Vietnamese diacritics, English text, question numbers, option labels, and reading order. Do not solve questions, infer missing text, or add text.`
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Page index ${input.pageIndex}. Return one non-empty visual text line per array entry.`
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${Buffer.from(input.pngBytes).toString('base64')}`
            }
          }
        ]
      }
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: TOOL_NAME,
          description: 'Submit the exact line-by-line transcription for one scanned exam page.',
          strict: true,
          parameters: z.toJSONSchema(responseSchema)
        }
      }
    ],
    tool_choice: {
      type: 'function',
      function: { name: TOOL_NAME }
    },
    temperature: 0,
    max_completion_tokens: 8_000
  };
  const sentAt = new Date().toISOString();
  const requestJson = JSON.stringify(requestBody);
  const digest = createHash('sha256').update(requestJson).digest('hex');

  try {
    const response = await fetch(chatCompletionsUrl(connection.baseURL), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.authToken}`,
        'content-type': 'application/json'
      },
      body: requestJson,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) {
      await recordGatewayFailure({ status: response.status });

      return {
        kind: 'attempted',
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
      response: parsePageResponse(toolCall.function.arguments, input.pageIndex),
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
      console.error('requestExamImportVisionPage lease release error:', error);
    }
  }
}
