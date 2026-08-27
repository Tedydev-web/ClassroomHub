import { describe, expect, it } from 'vitest';
import { classifyUploadFailure, uploadFailureMessageKey } from './upload-failure';

describe('upload failure', () => {
  it('names a storage rejection instead of suggesting a retry', () => {
    expect(classifyUploadFailure({ response: { status: 401 } })).toBe('storage_rejected');
    expect(classifyUploadFailure({ response: { status: 403 } })).toBe('storage_rejected');
    expect(uploadFailureMessageKey('storage_rejected')).toBe('exam_import.upload.storage_rejected');
  });

  it('names a network failure when the request never reached a server', () => {
    expect(classifyUploadFailure({ code: 'ERR_NETWORK' })).toBe('network');
    expect(classifyUploadFailure({ code: 'ECONNABORTED' })).toBe('network');
  });

  it('falls back to the generic message for anything else', () => {
    expect(classifyUploadFailure({ response: { status: 500 } })).toBe('unknown');
    expect(classifyUploadFailure(new Error('boom'))).toBe('unknown');
    expect(uploadFailureMessageKey('unknown')).toBe('exam_import.upload.failed');
  });
});
