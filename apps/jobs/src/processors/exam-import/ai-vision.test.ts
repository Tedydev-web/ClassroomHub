import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertAgentRunAdmitted: vi.fn(),
  acquireExamImportAiLease: vi.fn(),
  getGatewaySettings: vi.fn(),
  getOrgGatewayLimits: vi.fn(),
  getOrganizationById: vi.fn(),
  readGatewayConnectionFromEnv: vi.fn(),
  recordGatewayFailure: vi.fn(),
  recordGatewaySuccess: vi.fn(),
  selectGatewayModelId: vi.fn()
}));

vi.mock('@cio/core/config/env', () => ({
  env: {
    EXAM_IMPORT_AI_ENABLED: 'true',
    EXAM_IMPORT_VISION_ENABLED: 'true',
    EXAM_IMPORT_VISION_MODEL: 'vision-model'
  }
}));
vi.mock('@cio/core/services/agent/gateway-run-admission', () => ({
  assertAgentRunAdmitted: mocks.assertAgentRunAdmitted
}));
vi.mock('@cio/core/services/agent/gateway-runtime', () => ({
  readGatewayConnectionFromEnv: mocks.readGatewayConnectionFromEnv,
  recordGatewayFailure: mocks.recordGatewayFailure,
  recordGatewaySuccess: mocks.recordGatewaySuccess,
  selectGatewayModelId: mocks.selectGatewayModelId
}));
vi.mock('@cio/core/services/agent/gateway-settings-store', () => ({
  getGatewaySettings: mocks.getGatewaySettings,
  getOrgGatewayLimits: mocks.getOrgGatewayLimits
}));
vi.mock('@cio/db/queries/organization', () => ({
  getOrganizationById: mocks.getOrganizationById
}));
vi.mock('./ai-lease', () => ({
  acquireExamImportAiLease: mocks.acquireExamImportAiLease
}));

import { env } from '@cio/core/config/env';
import { requestExamImportVisionPage } from './ai-vision';

describe('requestExamImportVisionPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    env.EXAM_IMPORT_AI_ENABLED = 'true';
    env.EXAM_IMPORT_VISION_ENABLED = 'true';
    env.EXAM_IMPORT_VISION_MODEL = 'vision-model';
    mocks.getOrganizationById.mockResolvedValue({
      settings: { examImport: { aiEnabled: true, scanVisionEnabled: true } }
    });
    mocks.assertAgentRunAdmitted.mockResolvedValue({ admitted: true });
    mocks.getGatewaySettings.mockResolvedValue({
      defaultModelId: 'chat-default',
      globalConcurrency: 2,
      modelAllowlist: [
        {
          modelId: 'vision-model',
          label: 'Vision model',
          quotaWeight: 24,
          role: 'optional'
        },
        {
          modelId: 'checkpoint-model',
          label: 'Checkpoint model',
          quotaWeight: 30,
          role: 'optional'
        }
      ]
    });
    mocks.getOrgGatewayLimits.mockResolvedValue({ maxActiveRuns: 1 });
    mocks.acquireExamImportAiLease.mockResolvedValue({ release: vi.fn() });
    mocks.selectGatewayModelId.mockReturnValue('vision-model');
    mocks.readGatewayConnectionFromEnv.mockReturnValue({
      baseURL: 'https://gateway.example.test',
      authToken: 'test-token'
    });
  });

  it('rejects invalid page inputs before reading organization settings', async () => {
    await expect(
      requestExamImportVisionPage({
        organizationId: 'org-1',
        pageIndex: -1,
        pngBytes: new Uint8Array([1])
      })
    ).rejects.toThrow(RangeError);
    await expect(
      requestExamImportVisionPage({
        organizationId: 'org-1',
        pageIndex: 0,
        pngBytes: new Uint8Array()
      })
    ).rejects.toThrow(RangeError);
    expect(mocks.getOrganizationById).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requires both the global AI gate and organization consent', async () => {
    mocks.getOrganizationById.mockResolvedValue({ settings: {} });

    await expect(
      requestExamImportVisionPage({
        organizationId: 'org-1',
        pageIndex: 0,
        pngBytes: new Uint8Array([1, 2, 3])
      })
    ).resolves.toEqual({ kind: 'disabled', reason: 'organization_disabled' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requires separate consent before transmitting full-page scan images', async () => {
    mocks.getOrganizationById.mockResolvedValue({
      settings: { examImport: { aiEnabled: true } }
    });

    await expect(
      requestExamImportVisionPage({
        organizationId: 'org-1',
        pageIndex: 0,
        pngBytes: new Uint8Array([1, 2, 3])
      })
    ).resolves.toEqual({ kind: 'disabled', reason: 'organization_vision_disabled' });
    expect(mocks.assertAgentRunAdmitted).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses an independent default-off rollback switch for scanned PDF vision', async () => {
    env.EXAM_IMPORT_VISION_ENABLED = 'false';

    await expect(
      requestExamImportVisionPage({
        organizationId: 'org-1',
        pageIndex: 0,
        pngBytes: new Uint8Array([1, 2, 3])
      })
    ).resolves.toEqual({ kind: 'disabled', reason: 'vision_disabled' });
    expect(mocks.getOrganizationById).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requires an explicit allowlisted vision model pin', async () => {
    env.EXAM_IMPORT_VISION_MODEL = undefined;

    await expect(
      requestExamImportVisionPage({
        organizationId: 'org-1',
        pageIndex: 0,
        pngBytes: new Uint8Array([1, 2, 3])
      })
    ).resolves.toEqual({ kind: 'disabled', reason: 'model_unavailable' });
    expect(mocks.selectGatewayModelId).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps using the model pinned by an existing import checkpoint', async () => {
    mocks.selectGatewayModelId.mockReturnValue('checkpoint-model');
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      name: 'submit_exam_page_transcription',
                      arguments: JSON.stringify({ pageIndex: 1, lines: ['Question 1'] })
                    }
                  }
                ]
              }
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    await requestExamImportVisionPage({
      organizationId: 'org-1',
      pageIndex: 1,
      pngBytes: new Uint8Array([1, 2, 3]),
      model: 'checkpoint-model'
    });

    expect(mocks.selectGatewayModelId).toHaveBeenCalledWith(expect.anything(), 'checkpoint-model');
  });

  it('yields without sending the page when capacity is unavailable', async () => {
    mocks.acquireExamImportAiLease.mockResolvedValue(null);

    await expect(
      requestExamImportVisionPage({
        organizationId: 'org-1',
        pageIndex: 2,
        pngBytes: new Uint8Array([1, 2, 3])
      })
    ).resolves.toEqual({ kind: 'waiting' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends the page through a forced strict tool and accepts the matching page only', async () => {
    const release = vi.fn();
    mocks.acquireExamImportAiLease.mockResolvedValue({ release });
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      name: 'submit_exam_page_transcription',
                      arguments: JSON.stringify({
                        pageIndex: 2,
                        lines: ['Question 1. Choose the correct answer.', 'A. First', 'B. Second']
                      })
                    }
                  }
                ]
              }
            }
          ],
          usage: { prompt_tokens: 300, completion_tokens: 80 }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const result = await requestExamImportVisionPage({
      organizationId: 'org-1',
      pageIndex: 2,
      pngBytes: new Uint8Array([1, 2, 3])
    });

    expect(result).toMatchObject({
      kind: 'attempted',
      model: 'vision-model',
      quotaMultiplier: 24,
      promptTokens: 300,
      completionTokens: 80,
      transportAvailable: true,
      response: {
        pageIndex: 2,
        lines: ['Question 1. Choose the correct answer.', 'A. First', 'B. Second']
      }
    });
    const request = vi.mocked(fetch).mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body)) as {
      messages: Array<{ content: string | Array<{ image_url?: { url: string } }> }>;
      tool_choice: { function: { name: string } };
      tools: Array<{ function: { strict: boolean; parameters: { properties: { pageIndex: { const: number } } } } }>;
    };
    const userContent = body.messages[1]?.content;
    expect(Array.isArray(userContent) && userContent[1]?.image_url?.url).toBe('data:image/png;base64,AQID');
    expect(body.tool_choice.function.name).toBe('submit_exam_page_transcription');
    expect(body.tools[0]?.function.strict).toBe(true);
    expect(body.tools[0]?.function.parameters.properties.pageIndex.const).toBe(2);
    expect(mocks.recordGatewaySuccess).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it('rejects a schema-valid response for a different page', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      name: 'submit_exam_page_transcription',
                      arguments: JSON.stringify({ pageIndex: 1, lines: ['Wrong page'] })
                    }
                  }
                ]
              }
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    await expect(
      requestExamImportVisionPage({
        organizationId: 'org-1',
        pageIndex: 2,
        pngBytes: new Uint8Array([1, 2, 3])
      })
    ).resolves.toMatchObject({
      kind: 'attempted',
      response: null,
      transportAvailable: true
    });
  });

  it('retains usage when the gateway envelope or tool response is invalid', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      name: 'unexpected_tool',
                      arguments: '{}'
                    }
                  }
                ]
              }
            }
          ],
          usage: { prompt_tokens: 250, completion_tokens: 40 }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    await expect(
      requestExamImportVisionPage({
        organizationId: 'org-1',
        pageIndex: 0,
        pngBytes: new Uint8Array([1, 2, 3])
      })
    ).resolves.toMatchObject({
      kind: 'attempted',
      response: null,
      promptTokens: 250,
      completionTokens: 40,
      transportAvailable: true
    });
  });
});
