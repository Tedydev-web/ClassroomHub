/**
 * Why an upload failed, in the words the person reading it needs.
 *
 * Storage returned 401 for sixteen days and every teacher was told "could not upload the
 * document, please try again". They tried again. Nobody looked at the storage credentials,
 * because nothing pointed there. A rejection by the storage service is not a transient
 * error and must never be reported as one.
 */
export type UploadFailureReason = 'storage_rejected' | 'network' | 'unknown';

/** Status codes storage returns when it refuses the request itself, not the payload. */
const STORAGE_REJECTION_STATUSES = new Set([401, 403]);

export function classifyUploadFailure(error: unknown): UploadFailureReason {
  const status = readStatus(error);
  if (status !== null && STORAGE_REJECTION_STATUSES.has(status)) return 'storage_rejected';
  if (status !== null) return 'unknown';

  // Axios reports a request that never got a response with no status at all.
  const code = readCode(error);
  if (code === 'ERR_NETWORK' || code === 'ECONNABORTED' || code === 'ETIMEDOUT') return 'network';

  return 'unknown';
}

export function uploadFailureMessageKey(reason: UploadFailureReason): string {
  switch (reason) {
    case 'storage_rejected':
      return 'exam_import.upload.storage_rejected';
    case 'network':
      return 'exam_import.upload.network';
    default:
      return 'exam_import.upload.failed';
  }
}

function readStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as { status?: unknown; response?: { status?: unknown } };
  const status = typeof candidate.status === 'number' ? candidate.status : candidate.response?.status;

  return typeof status === 'number' ? status : null;
}

function readCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;

  return typeof code === 'string' ? code : null;
}
