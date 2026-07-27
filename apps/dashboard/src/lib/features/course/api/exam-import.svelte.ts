import {
  ZExamImportAiSuggestion,
  ZExamImportAnswerKey,
  ZExamImportCreate,
  ZExamImportDraftPatch
} from '@cio/utils/validation/exam-import';
import { BaseApiWithErrors, classroomhub } from '$lib/utils/services/api';
import { DocumentUploader } from '$lib/utils/services/courses/presign';
import { lessonDocUpload, resetDocumentUploadStore } from '$features/course/components/lesson/store';
import { mediaApi } from '$features/media/api';
import { snackbar } from '$features/ui/snackbar/store';
import { t } from '$lib/utils/functions/translations';
import { env } from '$env/dynamic/public';
import { SvelteDate } from 'svelte/reactivity';
import type {
  ApplyExamImportAnswerKeyRequest,
  CancelExamImportRequest,
  CreateExamImportRequest,
  EstimateExamImportAiSuggestionRequest,
  ExamImportAiSuggestionEstimate,
  ExamImportDraftPatchOperation,
  ExamImportDraftView,
  ExamImportStatus,
  GetExamImportDraftRequest,
  GetExamImportStatusRequest,
  PatchExamImportDraftRequest,
  PublishedExamImport,
  PublishExamImportRequest,
  RequestExamImportAiSuggestionRequest
} from '$features/course/utils/types';

const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_MIME_TYPE = 'application/pdf';
const TEXT_MIME_TYPE = 'text/plain';
const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_ATTEMPTS = 300;

function isDocxFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.docx') && (!file.type || file.type === DOCX_MIME_TYPE);
}

function isPdfFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.pdf') && (!file.type || file.type === PDF_MIME_TYPE);
}

function isInterchangeFile(file: File): boolean {
  const name = file.name.toLowerCase();

  return (name.endsWith('.aiken') || name.endsWith('.gift')) && (!file.type || file.type === TEXT_MIME_TYPE);
}

export class ExamImportApi extends BaseApiWithErrors {
  status = $state<ExamImportStatus | null>(null);
  draftView = $state<ExamImportDraftView | null>(null);
  isUploading = $state(false);
  isPolling = $state(false);
  private pollGeneration = 0;
  private readonly documentUploader = new DocumentUploader();

  async uploadAndCreate(courseId: string, file: File, maxDocumentBytes: number): Promise<string | null> {
    const pdfEnabled = env.PUBLIC_EXAM_IMPORT_PDF_ENABLED === 'true';
    if (!isDocxFile(file) && !isInterchangeFile(file) && !(pdfEnabled && isPdfFile(file))) {
      const errorKey = pdfEnabled ? 'exam_import.upload.document_only' : 'exam_import.upload.docx_only';
      this.errors.file = errorKey;
      snackbar.error(errorKey);
      return null;
    }
    if (file.size === 0 || file.size > maxDocumentBytes) {
      this.errors.file = 'exam_import.upload.invalid_size';
      snackbar.error('exam_import.upload.invalid_size');
      return null;
    }

    this.isUploading = true;
    this.documentUploader.initUpload();
    try {
      const uploadFile =
        isInterchangeFile(file) && !file.type ? new File([file], file.name, { type: TEXT_MIME_TYPE }) : file;
      const upload = await this.documentUploader.getPresignedUrl(uploadFile);
      await this.documentUploader.uploadFile({ url: upload.url, file: uploadFile });
      lessonDocUpload.update((state) => ({ ...state, uploadProgress: 100 }));

      const asset = await mediaApi.createAsset({
        kind: 'document',
        provider: 'upload',
        storageProvider: 's3',
        storageKey: upload.fileKey,
        mimeType:
          uploadFile.type ||
          (isPdfFile(uploadFile) ? PDF_MIME_TYPE : isInterchangeFile(uploadFile) ? TEXT_MIME_TYPE : DOCX_MIME_TYPE),
        byteSize: file.size,
        title: file.name,
        isExternal: false,
        metadata: {
          fileName: file.name,
          createdAt: new SvelteDate().toISOString(),
          purpose: 'exam_import'
        }
      });
      if (!asset) {
        snackbar.error('exam_import.upload.failed');
        return null;
      }

      return this.create(courseId, asset.id);
    } catch (error) {
      console.error('ExamImportApi.uploadAndCreate error:', error);
      snackbar.error('exam_import.upload.failed');
      return null;
    } finally {
      this.isUploading = false;
      resetDocumentUploadStore();
    }
  }

  async create(courseId: string, assetId: string): Promise<string | null> {
    const parsed = ZExamImportCreate.safeParse({ assetId });
    if (!parsed.success) {
      this.errors.assetId = 'exam_import.upload.invalid_source';
      return null;
    }

    let importId: string | null = null;
    await this.execute<CreateExamImportRequest>({
      requestFn: () =>
        classroomhub.course[':courseId']['exam-import'].$post({
          param: { courseId },
          json: parsed.data
        }),
      logContext: 'creating exam import',
      onSuccess: (response) => {
        this.status = response.data;
        importId = response.data.id;
      },
      onError: () => {
        snackbar.error('exam_import.upload.failed');
      }
    });

    return importId;
  }

  async getStatus(courseId: string, importId: string): Promise<ExamImportStatus | null> {
    let status: ExamImportStatus | null = null;
    await this.execute<GetExamImportStatusRequest>({
      requestFn: () =>
        classroomhub.course[':courseId']['exam-import'][':importId'].$get({
          param: { courseId, importId }
        }),
      logContext: 'fetching exam import status',
      onSuccess: (response) => {
        this.status = response.data;
        status = response.data;
      }
    });

    return status;
  }

  async getDraft(courseId: string, importId: string): Promise<ExamImportDraftView | null> {
    let draftView: ExamImportDraftView | null = null;
    await this.execute<GetExamImportDraftRequest>({
      requestFn: () =>
        classroomhub.course[':courseId']['exam-import'][':importId'].draft.$get({
          param: { courseId, importId }
        }),
      logContext: 'fetching exam import draft',
      onSuccess: (response) => {
        this.draftView = response.data;
        draftView = response.data;
      }
    });

    return draftView;
  }

  async pollUntilReady(courseId: string, importId: string): Promise<void> {
    const generation = ++this.pollGeneration;
    this.isPolling = true;
    this.error = null;
    try {
      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS && generation === this.pollGeneration; attempt++) {
        const status = await this.getStatus(courseId, importId);
        if (!status) {
          if (generation === this.pollGeneration) this.error = 'exam_import.status.fetch_failed';
          return;
        }
        if (status.status === 'failed' || status.status === 'canceled') return;
        if (status.status === 'draft_ready' || status.status === 'published') {
          await this.getDraft(courseId, importId);
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }

      if (generation === this.pollGeneration) {
        this.error = 'exam_import.status.poll_timeout';
      }
    } finally {
      if (generation === this.pollGeneration) this.isPolling = false;
    }
  }

  stopPolling(): void {
    this.pollGeneration++;
    this.isPolling = false;
  }

  async cancel(courseId: string, importId: string): Promise<boolean> {
    let canceled = false;
    await this.execute<CancelExamImportRequest>({
      requestFn: () =>
        classroomhub.course[':courseId']['exam-import'][':importId'].cancel.$post({
          param: { courseId, importId }
        }),
      logContext: 'canceling exam import',
      onSuccess: () => {
        this.stopPolling();
        if (this.status) this.status.status = 'canceled';
        canceled = true;
      },
      onError: () => {
        snackbar.error('exam_import.status.cancel_failed');
      }
    });

    return canceled;
  }

  async patchDraft(courseId: string, importId: string, operations: ExamImportDraftPatchOperation[]): Promise<boolean> {
    const parsed = ZExamImportDraftPatch.safeParse({ operations });
    if (!parsed.success) {
      this.errors.operations = 'exam_import.review.invalid_edit';
      return false;
    }

    let updated = false;
    await this.execute<PatchExamImportDraftRequest>({
      requestFn: () =>
        classroomhub.course[':courseId']['exam-import'][':importId'].draft.$patch({
          param: { courseId, importId },
          json: parsed.data
        }),
      logContext: 'updating exam import draft',
      onSuccess: () => {
        updated = true;
      },
      onError: () => {
        snackbar.error('exam_import.review.save_failed');
      }
    });
    if (updated) await this.getDraft(courseId, importId);

    return updated;
  }

  async estimateAiSuggestions(
    courseId: string,
    importId: string,
    questionIds: string[]
  ): Promise<ExamImportAiSuggestionEstimate | null> {
    const parsed = ZExamImportAiSuggestion.safeParse({ questionIds });
    if (!parsed.success) {
      this.errors.questionIds = 'exam_import.review.ai_suggestion_invalid';
      return null;
    }

    let estimate: ExamImportAiSuggestionEstimate | null = null;
    await this.execute<EstimateExamImportAiSuggestionRequest>({
      requestFn: () =>
        classroomhub.course[':courseId']['exam-import'][':importId']['ai-suggestion'].estimate.$post({
          param: { courseId, importId },
          json: parsed.data
        }),
      logContext: 'estimating exam import AI suggestion',
      onSuccess: (response) => {
        estimate = response.data;
      },
      onError: () => {
        snackbar.error('exam_import.review.ai_suggestion_estimate_failed');
      }
    });

    return estimate;
  }

  async requestAiSuggestions(courseId: string, importId: string, questionIds: string[]): Promise<boolean> {
    const parsed = ZExamImportAiSuggestion.safeParse({ questionIds });
    if (!parsed.success) {
      this.errors.questionIds = 'exam_import.review.ai_suggestion_invalid';
      return false;
    }

    let queued = false;
    await this.execute<RequestExamImportAiSuggestionRequest>({
      requestFn: () =>
        classroomhub.course[':courseId']['exam-import'][':importId']['ai-suggestion'].$post({
          param: { courseId, importId },
          json: parsed.data
        }),
      logContext: 'requesting exam import AI suggestions',
      onSuccess: (response) => {
        queued = true;
        snackbar.success(t.get('exam_import.review.ai_suggestion_queued', { count: response.data.queuedCount }));
      },
      onError: () => {
        snackbar.error('exam_import.review.ai_suggestion_request_failed');
      }
    });

    return queued;
  }

  async waitForDraftUpdate(courseId: string, importId: string, previousUpdatedAt: string): Promise<boolean> {
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const draft = await this.getDraft(courseId, importId);
      if (!draft) return false;
      if (draft.updatedAt !== previousUpdatedAt) return true;
    }

    return false;
  }

  async applyAnswerKey(courseId: string, importId: string, key: string): Promise<boolean> {
    const parsed = ZExamImportAnswerKey.safeParse({ key });
    if (!parsed.success) {
      this.errors.key = 'exam_import.answer_key.invalid';
      return false;
    }

    let updated = false;
    await this.execute<ApplyExamImportAnswerKeyRequest>({
      requestFn: () =>
        classroomhub.course[':courseId']['exam-import'][':importId']['answer-key'].$post({
          param: { courseId, importId },
          json: parsed.data
        }),
      logContext: 'applying exam import answer key',
      onSuccess: (response) => {
        updated = true;
        snackbar.success(t.get('exam_import.answer_key.applied', { count: response.data.appliedCount }));
      },
      onError: () => {
        snackbar.error('exam_import.answer_key.failed');
      }
    });
    if (updated) await this.getDraft(courseId, importId);

    return updated;
  }

  async publish(courseId: string, importId: string): Promise<PublishedExamImport | null> {
    let published: PublishedExamImport | null = null;
    await this.execute<PublishExamImportRequest>({
      requestFn: () =>
        classroomhub.course[':courseId']['exam-import'][':importId'].publish.$post({
          param: { courseId, importId }
        }),
      logContext: 'publishing exam import',
      onSuccess: (response) => {
        published = response.data;
      },
      onError: () => {
        snackbar.error('exam_import.publish.failed');
      }
    });

    return published;
  }

  override reset(): void {
    this.stopPolling();
    super.reset();
    this.status = null;
    this.draftView = null;
    this.isUploading = false;
    resetDocumentUploadStore();
  }
}

export const examImportApi = new ExamImportApi();
