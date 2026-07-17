import {
  FILE_UPLOAD_DEFAULT_MAX_SIZE_MB,
  FILE_UPLOAD_SUPPORTED_TYPES,
  isFileUploadSizeAllowed,
  isFileUploadTypeAllowed,
  normalizeAcceptedFileTypes,
  resolveExerciseFileUploadMaxSizeMb
} from '@cio/question-types';

export { FILE_UPLOAD_DEFAULT_MAX_SIZE_MB, FILE_UPLOAD_SUPPORTED_TYPES, normalizeAcceptedFileTypes };
/** @deprecated Use FILE_UPLOAD_DEFAULT_MAX_SIZE_MB */
export const FILE_UPLOAD_MAX_SIZE_MB = FILE_UPLOAD_DEFAULT_MAX_SIZE_MB;

export function formatAcceptedFileTypes(values: string[]): string {
  return values
    .map((value) => FILE_UPLOAD_SUPPORTED_TYPES.find((entry) => entry.value === value)?.label ?? value)
    .filter(Boolean)
    .join(', ');
}

export function isFileTypeAllowed(file: File, acceptedTypes: string[]): boolean {
  return isFileUploadTypeAllowed({ fileName: file.name, mimeType: file.type }, acceptedTypes);
}

export { resolveExerciseFileUploadMaxSizeMb };

export function isFileSizeAllowed(
  file: File,
  maxSizeMb: number | undefined | null,
  platformMaxSizeMb: number = FILE_UPLOAD_DEFAULT_MAX_SIZE_MB
): boolean {
  return isFileUploadSizeAllowed(file.size, maxSizeMb, platformMaxSizeMb);
}
