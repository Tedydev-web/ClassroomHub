export const FILE_UPLOAD_DEFAULT_MAX_SIZE_MB = 2;

export const FILE_UPLOAD_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska'
] as const;

export type FileUploadMimeType = (typeof FILE_UPLOAD_MIME_TYPES)[number];

export const FILE_UPLOAD_SUPPORTED_TYPES = [
  { value: 'application/pdf', label: 'PDF (.pdf)', aliases: ['pdf', '.pdf'], extension: 'pdf' },
  {
    value: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    label: 'DOCX (.docx)',
    aliases: ['docx', '.docx'],
    extension: 'docx'
  },
  { value: 'application/msword', label: 'DOC (.doc)', aliases: ['doc', '.doc'], extension: 'doc' },
  {
    value: 'image/jpeg',
    label: 'JPEG (.jpg, .jpeg)',
    aliases: ['jpg', '.jpg', 'jpeg', '.jpeg', 'image/jpg'],
    extension: 'jpg'
  },
  { value: 'image/png', label: 'PNG (.png)', aliases: ['png', '.png'], extension: 'png' },
  { value: 'image/webp', label: 'WEBP (.webp)', aliases: ['webp', '.webp'], extension: 'webp' },
  { value: 'image/gif', label: 'GIF (.gif)', aliases: ['gif', '.gif'], extension: 'gif' },
  { value: 'video/mp4', label: 'MP4 (.mp4)', aliases: ['mp4', '.mp4'], extension: 'mp4' },
  { value: 'video/quicktime', label: 'MOV (.mov)', aliases: ['mov', '.mov'], extension: 'mov' },
  { value: 'video/x-msvideo', label: 'AVI (.avi)', aliases: ['avi', '.avi'], extension: 'avi' },
  { value: 'video/x-matroska', label: 'MKV (.mkv)', aliases: ['mkv', '.mkv'], extension: 'mkv' }
] as const satisfies ReadonlyArray<{
  value: FileUploadMimeType;
  label: string;
  aliases: readonly string[];
  extension: string;
}>;

type SupportedFileUploadType = (typeof FILE_UPLOAD_SUPPORTED_TYPES)[number];

const SUPPORTED_TYPE_BY_VALUE = new Map<FileUploadMimeType, SupportedFileUploadType>(
  FILE_UPLOAD_SUPPORTED_TYPES.map((entry) => [entry.value, entry])
);

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function toCanonicalAcceptedType(value: string): FileUploadMimeType | null {
  const normalizedValue = normalizeToken(value);
  if (!normalizedValue) return null;

  if (FILE_UPLOAD_MIME_TYPES.includes(normalizedValue as FileUploadMimeType)) {
    return normalizedValue as FileUploadMimeType;
  }

  for (const fileType of FILE_UPLOAD_SUPPORTED_TYPES) {
    if (fileType.aliases.some((alias) => normalizeToken(alias) === normalizedValue)) {
      return fileType.value;
    }
  }

  return null;
}

function getFileExtension(fileName: string): string | null {
  const extensionSeparatorIndex = fileName.lastIndexOf('.');
  if (extensionSeparatorIndex < 0) return null;

  return normalizeToken(fileName.slice(extensionSeparatorIndex));
}

export function normalizeAcceptedFileTypes(value: unknown): FileUploadMimeType[] {
  const rawValues = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const seen = new Set<FileUploadMimeType>();
  const normalized: FileUploadMimeType[] = [];

  for (const rawValue of rawValues) {
    if (typeof rawValue !== 'string') continue;

    const canonicalValue = toCanonicalAcceptedType(rawValue);
    if (!canonicalValue || seen.has(canonicalValue)) continue;

    seen.add(canonicalValue);
    normalized.push(canonicalValue);
  }

  return normalized;
}

export function resolveCanonicalFileUploadMimeType(input: {
  fileName: string;
  mimeType: string;
}): FileUploadMimeType | null {
  const normalizedMimeType = normalizeToken(input.mimeType).split(';', 1)[0] ?? '';
  const mimeType = normalizedMimeType ? toCanonicalAcceptedType(normalizedMimeType) : null;
  if (normalizedMimeType && !mimeType) return null;

  const extension = getFileExtension(input.fileName);
  const extensionMimeType = extension ? toCanonicalAcceptedType(extension) : null;
  if (mimeType && extensionMimeType && mimeType !== extensionMimeType) return null;

  return mimeType ?? extensionMimeType;
}

export function resolveAllowedFileUploadMimeTypes(value: unknown): readonly FileUploadMimeType[] {
  const configuredTypes = normalizeAcceptedFileTypes(value);
  return configuredTypes.length > 0 ? configuredTypes : FILE_UPLOAD_MIME_TYPES;
}

export function isFileUploadTypeAllowed(
  input: { fileName: string; mimeType: string },
  acceptedTypes: readonly string[]
): boolean {
  const canonicalMimeType = resolveCanonicalFileUploadMimeType(input);
  if (!canonicalMimeType) return false;

  const normalizedAcceptedTypes = normalizeAcceptedFileTypes(acceptedTypes);
  const allowedTypes = normalizedAcceptedTypes.length > 0 ? normalizedAcceptedTypes : FILE_UPLOAD_MIME_TYPES;
  return allowedTypes.includes(canonicalMimeType);
}

export function getFileUploadExtension(mimeType: FileUploadMimeType): string {
  return SUPPORTED_TYPE_BY_VALUE.get(mimeType)?.extension ?? 'bin';
}

export function resolveExerciseFileUploadMaxSizeMb(
  questionMaxSizeMb: number | undefined | null,
  platformMaxSizeMb: number = FILE_UPLOAD_DEFAULT_MAX_SIZE_MB
): number {
  const effectivePlatformMax =
    typeof platformMaxSizeMb === 'number' && platformMaxSizeMb > 0
      ? platformMaxSizeMb
      : FILE_UPLOAD_DEFAULT_MAX_SIZE_MB;
  const requestedMax =
    typeof questionMaxSizeMb === 'number' && questionMaxSizeMb > 0 ? questionMaxSizeMb : effectivePlatformMax;

  return Math.min(requestedMax, effectivePlatformMax);
}

export function isFileUploadSizeAllowed(
  size: number,
  questionMaxSizeMb: number | undefined | null,
  platformMaxSizeMb: number = FILE_UPLOAD_DEFAULT_MAX_SIZE_MB
): boolean {
  if (!Number.isSafeInteger(size) || size <= 0) return false;

  const effectiveMaxMb = resolveExerciseFileUploadMaxSizeMb(questionMaxSizeMb, platformMaxSizeMb);
  return size <= effectiveMaxMb * 1024 * 1024;
}
