import JSZip from 'jszip';

/**
 * Opens a `.docx` and exposes the parts the reader needs.
 *
 * A `.docx` is a zip supplied by whoever uploaded it, so it is hostile input
 * until proven otherwise. Every limit below exists because the alternative is a
 * request that exhausts memory or writes outside its directory. Nothing here
 * extracts to disk — parts are read into memory on demand — which removes path
 * traversal as an outcome, but entry names are still checked so a malformed
 * package fails loudly rather than resolving to something unexpected.
 */

export type DocxPackageLimits = {
  maxEntries: number;
  maxTotalUncompressedBytes: number;
  maxPartBytes: number;
};

export const DEFAULT_DOCX_LIMITS: DocxPackageLimits = {
  /** A large exam with many images stays far below this. */
  maxEntries: 2_000,
  maxTotalUncompressedBytes: 300 * 1024 * 1024,
  maxPartBytes: 100 * 1024 * 1024
};

export const DOCX_PART = {
  document: 'word/document.xml',
  numbering: 'word/numbering.xml',
  styles: 'word/styles.xml',
  documentRelations: 'word/_rels/document.xml.rels'
} as const;

export class DocxPackageError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'NOT_A_ZIP'
      | 'TOO_MANY_ENTRIES'
      | 'ENTRY_TOO_LARGE'
      | 'PACKAGE_TOO_LARGE'
      | 'UNSAFE_ENTRY_NAME'
      | 'MISSING_DOCUMENT'
  ) {
    super(message);
    this.name = 'DocxPackageError';
  }
}

/**
 * Rejects absolute paths, drive letters, and any traversal segment. Checked on
 * the raw name before normalisation, because normalising first is how a
 * traversal slips past a check that looks correct.
 */
function assertSafeEntryName(name: string): void {
  const unsafe =
    name.startsWith('/') ||
    name.startsWith('\\') ||
    /^[A-Za-z]:/.test(name) ||
    name.split(/[/\\]/).some((segment) => segment === '..');

  if (unsafe) {
    throw new DocxPackageError(`Package entry "${name}" has an unsafe name`, 'UNSAFE_ENTRY_NAME');
  }
}

export type DocxPackage = {
  /** Part contents as text, or `null` when the part is absent. */
  readText(part: string): Promise<string | null>;
  /** Part contents as bytes, or `null` when the part is absent. */
  readBytes(part: string): Promise<Uint8Array | null>;
  /** Every entry name in the package, in the order the zip lists them. */
  entryNames(): string[];
};

export async function openDocxPackage(
  data: Uint8Array,
  limits: DocxPackageLimits = DEFAULT_DOCX_LIMITS
): Promise<DocxPackage> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new DocxPackageError('File is not a readable zip archive', 'NOT_A_ZIP');
  }

  const entries = Object.values(zip.files);
  if (entries.length > limits.maxEntries) {
    throw new DocxPackageError(
      `Package holds ${entries.length} entries, above the limit of ${limits.maxEntries}`,
      'TOO_MANY_ENTRIES'
    );
  }

  let declaredTotal = 0;
  for (const entry of entries) {
    assertSafeEntryName(entry.name);

    // JSZip exposes the central directory's uncompressed size, which lets a
    // decompression bomb be refused before any of it is decompressed.
    const declaredSize = Number(
      (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0
    );
    if (declaredSize > limits.maxPartBytes) {
      throw new DocxPackageError(`Package entry "${entry.name}" declares an oversized payload`, 'ENTRY_TOO_LARGE');
    }

    declaredTotal += declaredSize;
    if (declaredTotal > limits.maxTotalUncompressedBytes) {
      throw new DocxPackageError('Package expands beyond the allowed total size', 'PACKAGE_TOO_LARGE');
    }
  }

  if (!zip.file(DOCX_PART.document)) {
    throw new DocxPackageError(`Package has no ${DOCX_PART.document}`, 'MISSING_DOCUMENT');
  }

  async function readBytes(part: string): Promise<Uint8Array | null> {
    const file = zip.file(part);
    if (!file) return null;

    const bytes = await file.async('uint8array');
    if (bytes.byteLength > limits.maxPartBytes) {
      throw new DocxPackageError(`Package entry "${part}" exceeded its size limit`, 'ENTRY_TOO_LARGE');
    }

    return bytes;
  }

  return {
    async readText(part) {
      const bytes = await readBytes(part);

      return bytes === null ? null : new TextDecoder('utf-8').decode(bytes);
    },
    readBytes,
    entryNames: () => entries.map((entry) => entry.name)
  };
}
