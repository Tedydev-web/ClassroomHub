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
  maxCompressedBytes: number;
  maxEntries: number;
  maxTotalUncompressedBytes: number;
  maxPartBytes: number;
};

export const DEFAULT_DOCX_LIMITS: DocxPackageLimits = {
  maxCompressedBytes: 100 * 1024 * 1024,
  /** A large exam with many images stays far below this. */
  maxEntries: 2_000,
  maxTotalUncompressedBytes: 300 * 1024 * 1024,
  maxPartBytes: 100 * 1024 * 1024
};

export const DOCX_PART = {
  document: 'word/document.xml',
  numbering: 'word/numbering.xml',
  styles: 'word/styles.xml',
  theme: 'word/theme/theme1.xml',
  documentRelations: 'word/_rels/document.xml.rels'
} as const;

export class DocxPackageError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'NOT_A_ZIP'
      | 'INPUT_TOO_LARGE'
      | 'TOO_MANY_ENTRIES'
      | 'ENTRY_TOO_LARGE'
      | 'PACKAGE_TOO_LARGE'
      | 'UNSAFE_ENTRY_NAME'
      | 'INVALID_TEXT_ENCODING'
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

type XmlEncoding = 'utf-8' | 'utf-16le' | 'utf-16be';

function decodeXmlBytes(bytes: Uint8Array): { text: string; encoding: XmlEncoding } {
  let encoding: XmlEncoding = 'utf-8';
  if (
    (bytes[0] === 0xff && bytes[1] === 0xfe) ||
    (bytes[0] === 0x3c && bytes[1] === 0x00 && bytes[2] === 0x3f && bytes[3] === 0x00)
  ) {
    encoding = 'utf-16le';
  } else if (
    (bytes[0] === 0xfe && bytes[1] === 0xff) ||
    (bytes[0] === 0x00 && bytes[1] === 0x3c && bytes[2] === 0x00 && bytes[3] === 0x3f)
  ) {
    encoding = 'utf-16be';
  }

  try {
    return { text: new TextDecoder(encoding, { fatal: true }).decode(bytes), encoding };
  } catch {
    throw new DocxPackageError(`Package XML is not valid ${encoding.toUpperCase()}`, 'INVALID_TEXT_ENCODING');
  }
}

export type DocxPackage = {
  /** Part contents as text, or `null` when the part is absent. */
  readText(part: string): Promise<string | null>;
  /** Part contents as bytes, or `null` when the part is absent. */
  readBytes(part: string): Promise<Uint8Array | null>;
  /** Every entry name in the package, in the order the zip lists them. */
  entryNames(): string[];
  /** Original bytes, with UTF-16 XML normalized for officeparser compatibility when needed. */
  bytesForOfficeParser(): Promise<Uint8Array>;
};

export async function openDocxPackage(
  data: Uint8Array,
  limits: DocxPackageLimits = DEFAULT_DOCX_LIMITS
): Promise<DocxPackage> {
  if (data.byteLength > limits.maxCompressedBytes) {
    throw new DocxPackageError('Compressed DOCX input exceeds the allowed size', 'INPUT_TOO_LARGE');
  }

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
  const normalizedXmlParts = new Map<string, string>();

  return {
    async readText(part) {
      const bytes = await readBytes(part);
      if (bytes === null) return null;
      const decoded = decodeXmlBytes(bytes);
      if (decoded.encoding !== 'utf-8') {
        const normalizedDeclaration = decoded.text.replace(
          /^<\?xml([^>]*?)encoding=(["'])UTF-16(?:LE|BE)?\2([^>]*?)\?>/i,
          '<?xml$1encoding=$2UTF-8$2$3?>'
        );
        normalizedXmlParts.set(part, normalizedDeclaration);
      }

      return decoded.text;
    },
    readBytes,
    entryNames: () => entries.map((entry) => entry.name),
    async bytesForOfficeParser() {
      if (normalizedXmlParts.size === 0) return data;
      for (const [part, text] of normalizedXmlParts) zip.file(part, text);
      const normalized = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
      if (normalized.byteLength > limits.maxCompressedBytes) {
        throw new DocxPackageError('Normalized DOCX input exceeds the allowed size', 'INPUT_TOO_LARGE');
      }

      return normalized;
    }
  };
}
