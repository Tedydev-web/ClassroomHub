import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExamImportDraft, ExamImportQuestion } from '@cio/exam-import/draft/exam-import-draft';
import { emptyFormatting, type SourceRun } from '@cio/exam-import/source-run';

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
  env: { EXAM_IMPORT_AI_ENABLED: 'true', EXAM_IMPORT_AI_MODEL: undefined }
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

import { requestNextExamImportAiRegion } from './ai-region';
import { env } from '@cio/core/config/env';

const provenance = [
  {
    start: { blockIndex: 0, runIndex: 0 },
    end: { blockIndex: 2, runIndex: 0 },
    pageStart: null,
    pageEnd: null
  }
];

function sourceRun(blockIndex: number, runIndex: number, text: string, listNumber: string | null = null): SourceRun {
  return {
    text,
    formatting: emptyFormatting(),
    block: {
      kind: listNumber ? 'list_item' : 'paragraph',
      index: blockIndex,
      listNumber,
      tableRef: null
    },
    math: null,
    image: null,
    location: { blockIndex, runIndex }
  };
}

function keylessQuestion(): Extract<ExamImportQuestion, { kind: 'choice' }> {
  return {
    id: 'question-1',
    kind: 'choice',
    order: 0,
    sourceNumber: '1',
    promptHtml: '<p>Choose.</p>',
    points: 1,
    cognitiveLevel: null,
    passageId: null,
    cardinality: 'single',
    options: [
      { id: 'option-a', sourceLabel: 'A', html: '<p>First</p>', order: 0 },
      { id: 'option-b', sourceLabel: 'B', html: '<p>Second</p>', order: 1 }
    ],
    answerCandidates: [],
    answerKey: null,
    confidence: 'none',
    review: 'unresolved',
    provenance
  };
}

function draft(): ExamImportDraft {
  return {
    schemaVersion: 1,
    source: {
      assetId: 'asset-1',
      fileName: 'exam.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extractor: 'docx'
    },
    title: 'Sample exam',
    fieldStates: [],
    sharedContents: [],
    sections: [{ id: 'section-1', title: 'Part I', order: 0, questions: [keylessQuestion()] }],
    diagnostics: []
  };
}

function resolvedQuestion(): ExamImportQuestion {
  const question = keylessQuestion();

  return {
    ...question,
    answerCandidates: [
      {
        id: 'candidate-ai',
        kind: 'choice',
        correctOptionIds: ['option-b'],
        source: 'ai',
        provenance
      }
    ],
    answerKey: {
      kind: 'choice',
      correctOptionIds: ['option-b'],
      agreement: 'single_source',
      selectedCandidateIds: ['candidate-ai'],
      conflictingCandidateIds: []
    },
    confidence: 'low',
    review: 'needs_attention'
  };
}

describe('requestNextExamImportAiRegion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    env.EXAM_IMPORT_AI_MODEL = 'model-a';
    mocks.getOrganizationById.mockResolvedValue({
      settings: { examImport: { aiEnabled: true } }
    });
    mocks.assertAgentRunAdmitted.mockResolvedValue({ admitted: true });
    mocks.getGatewaySettings.mockResolvedValue({
      defaultModelId: 'model-a',
      globalConcurrency: 2,
      modelAllowlist: [
        {
          modelId: 'model-a',
          label: 'Model A',
          quotaWeight: 12,
          role: 'optional'
        }
      ]
    });
    mocks.getOrgGatewayLimits.mockResolvedValue({ maxActiveRuns: 1 });
    mocks.acquireExamImportAiLease.mockResolvedValue({ release: vi.fn() });
    mocks.selectGatewayModelId.mockReturnValue('model-a');
    mocks.readGatewayConnectionFromEnv.mockReturnValue({
      baseURL: 'https://gateway.example.test',
      authToken: 'test-token'
    });
  });

  it('makes no gateway call without organization consent', async () => {
    mocks.getOrganizationById.mockResolvedValue({ settings: {} });

    await expect(
      requestNextExamImportAiRegion({
        draft: draft(),
        organizationId: 'org-1',
        auditedQuestionIds: new Set()
      })
    ).resolves.toEqual({ kind: 'disabled' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('yields without a gateway call when admission is denied', async () => {
    mocks.assertAgentRunAdmitted.mockResolvedValue({ admitted: false });

    await expect(
      requestNextExamImportAiRegion({
        draft: draft(),
        organizationId: 'org-1',
        auditedQuestionIds: new Set()
      })
    ).resolves.toEqual({ kind: 'waiting' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('yields without a gateway call when the atomic lease is full', async () => {
    mocks.acquireExamImportAiLease.mockResolvedValue(null);

    await expect(
      requestNextExamImportAiRegion({
        draft: draft(),
        organizationId: 'org-1',
        auditedQuestionIds: new Set()
      })
    ).resolves.toEqual({ kind: 'waiting' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the allowlisted exam-import model pin instead of the changing chat default', async () => {
    env.EXAM_IMPORT_AI_MODEL = 'model-pinned';
    mocks.selectGatewayModelId.mockReturnValue(null);

    await expect(
      requestNextExamImportAiRegion({
        draft: draft(),
        organizationId: 'org-1',
        auditedQuestionIds: new Set()
      })
    ).resolves.toEqual({ kind: 'disabled' });
    expect(mocks.selectGatewayModelId).toHaveBeenCalledWith(expect.any(Object), 'model-pinned');
  });

  it('makes no gateway call without an explicit exam-import model pin', async () => {
    env.EXAM_IMPORT_AI_MODEL = undefined;

    await expect(
      requestNextExamImportAiRegion({
        draft: draft(),
        organizationId: 'org-1',
        auditedQuestionIds: new Set()
      })
    ).resolves.toEqual({ kind: 'disabled' });
    expect(mocks.selectGatewayModelId).not.toHaveBeenCalled();
    expect(mocks.acquireExamImportAiLease).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends one unresolved region and accepts only a strict region response', async () => {
    const release = vi.fn();
    mocks.acquireExamImportAiLease.mockResolvedValue({ release });
    const argumentsJson = JSON.stringify({
      regions: [{ questionId: 'question-1', question: resolvedQuestion(), findings: [] }]
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      name: 'submit_exam_import_region',
                      arguments: argumentsJson
                    }
                  }
                ]
              }
            }
          ],
          usage: { prompt_tokens: 120, completion_tokens: 40 },
          extraProviderField: true
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const result = await requestNextExamImportAiRegion({
      draft: draft(),
      organizationId: 'org-1',
      auditedQuestionIds: new Set(),
      sourceRuns: [
        sourceRun(0, 0, 'Question 1. Choose the source-faithful option.'),
        sourceRun(1, 0, 'First'),
        sourceRun(2, 0, 'Second')
      ],
      auditSource: true
    });

    expect(result).toMatchObject({
      kind: 'attempted',
      model: 'model-a',
      quotaMultiplier: 12,
      promptTokens: 120,
      completionTokens: 40,
      transportAvailable: true,
      response: { regions: [{ questionId: 'question-1', findings: [] }] }
    });
    const request = vi.mocked(fetch).mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body)) as {
      messages: Array<{ content: string }>;
      tool_choice: { function: { name: string } };
      tools: Array<{ function: { strict: boolean } }>;
    };
    expect(body.messages[1]?.content).toContain('"questionId":"question-1"');
    expect(body.messages[1]?.content).toContain(
      '"sourceContext":{"instruction":"Part I","passage":null,"question":"Question 1. Choose the source-faithful option.\\nFirst\\nSecond"}'
    );
    expect(body.messages[0]?.content).toContain('Never infer or solve a missing answer key');
    expect(body.messages[1]?.content).not.toContain('Sample exam');
    expect(body.tool_choice.function.name).toBe('submit_exam_import_region');
    expect(body.tools[0]?.function.strict).toBe(false);
    expect(mocks.recordGatewaySuccess).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it('discards malformed model output without treating the transport as unavailable', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      name: 'submit_exam_import_region',
                      arguments: '{"regions":['
                    }
                  }
                ]
              }
            }
          ]
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }
      )
    );

    await expect(
      requestNextExamImportAiRegion({
        draft: draft(),
        organizationId: 'org-1',
        auditedQuestionIds: new Set()
      })
    ).resolves.toMatchObject({
      kind: 'attempted',
      response: null,
      transportAvailable: true
    });
  });

  it('retains billed usage when the strict gateway envelope is invalid', async () => {
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
          usage: { prompt_tokens: 90, completion_tokens: 30 }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    await expect(
      requestNextExamImportAiRegion({
        draft: draft(),
        organizationId: 'org-1',
        auditedQuestionIds: new Set()
      })
    ).resolves.toMatchObject({
      kind: 'attempted',
      response: null,
      quotaMultiplier: 12,
      promptTokens: 90,
      completionTokens: 30,
      transportAvailable: true
    });
  });

  it('fails closed on a gateway error', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('unavailable', { status: 503 }));

    await expect(
      requestNextExamImportAiRegion({
        draft: draft(),
        organizationId: 'org-1',
        auditedQuestionIds: new Set()
      })
    ).resolves.toMatchObject({
      kind: 'attempted',
      response: null,
      transportAvailable: false
    });
    expect(mocks.recordGatewayFailure).toHaveBeenCalledWith({ status: 503 });
  });
});
