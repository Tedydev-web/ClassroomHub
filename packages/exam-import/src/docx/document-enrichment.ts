import { posix } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import type { DocxPackage } from './docx-package';

/**
 * Information officeparser intentionally drops but the normalized stream must
 * preserve: embedded media and merged-table coordinates.
 *
 * This module reads OOXML directly and returns facts keyed by the top-level
 * block index. It never emits SourceRuns itself. Keeping it separate prevents
 * the main reader from becoming a second all-purpose DOCX parser and lets each
 * direct-OOXML feature be tested with a tiny synthetic document.
 */

export type DocxEmbeddedAsset = {
  ref: string;
  packagePath: string;
  mimeType: string;
  bytes: Uint8Array;
};

export type AnchoredImage = {
  assetRef: string;
  /** Text characters before the drawing's run inside its paragraph. */
  afterTextCharacters: number;
  width: number | null;
  height: number | null;
  floating: boolean;
};

export type TableCellOrigin = {
  /** Physical cell index as officeparser reports it. */
  physicalColumn: number;
  /** Grid coordinate after applying gridSpan. */
  column: number;
  /** Origin of a vertical merge; equal to row/column for a normal cell. */
  originRow: number;
  originColumn: number;
};

export type TableStructure = {
  tableIndex: number;
  /** Top-level OOXML block index. */
  sourceBlockIndex: number;
  rows: TableCellOrigin[][];
};

export type DocumentEnrichment = {
  /** Top-level paragraph index → drawings anchored in that paragraph. */
  imagesByBlock: Map<number, AnchoredImage[]>;
  assets: DocxEmbeddedAsset[];
  tablesByBlock: Map<number, TableStructure>;
};

type OrderedNode = Record<string, unknown>;
type Relationship = { target: string; external: boolean };

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_'
});

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  apng: 'image/apng',
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webp: 'image/webp'
};

function children(node: OrderedNode, key: string): OrderedNode[] {
  const value = node[key];

  return Array.isArray(value) ? (value as OrderedNode[]) : [];
}

function attrs(node: OrderedNode): Record<string, unknown> {
  const value = node[':@'];

  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function attr(node: OrderedNode, name: string): string | undefined {
  const value = attrs(node)[`@_${name}`];

  return value === undefined || value === null ? undefined : String(value);
}

/** Matching wrapper nodes, preserving attributes stored beside their content. */
function findChildren(nodes: OrderedNode[], key: string): OrderedNode[] {
  const found: OrderedNode[] = [];

  for (const node of nodes) {
    if (Object.hasOwn(node, key)) found.push(node);
    for (const [childKey, value] of Object.entries(node)) {
      if (childKey === ':@' || !Array.isArray(value)) continue;
      found.push(...findChildren(value as OrderedNode[], key));
    }
  }

  return found;
}

function firstChild(nodes: OrderedNode[], key: string): OrderedNode[] | null {
  for (const node of nodes) {
    const direct = children(node, key);
    if (direct.length > 0) return direct;

    for (const [childKey, value] of Object.entries(node)) {
      if (childKey === ':@' || !Array.isArray(value)) continue;
      const nested = firstChild(value as OrderedNode[], key);
      if (nested) return nested;
    }
  }

  return null;
}

/** Text only from `w:t`; coordinate values and DrawingML metadata are excluded. */
function wordText(nodes: OrderedNode[]): string {
  let text = '';

  for (const node of nodes) {
    const textContent = children(node, 'w:t');
    if (textContent.length > 0) {
      for (const item of textContent) {
        const value = item['#text'];
        if (typeof value === 'string' || typeof value === 'number') text += String(value);
      }
      continue;
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === ':@' || !Array.isArray(value)) continue;
      text += wordText(value as OrderedNode[]);
    }
  }

  return text;
}

function parseInteger(value: string | undefined, fallback = 0): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function emuToPixels(value: string | undefined): number | null {
  if (value === undefined) return null;
  const emu = Number(value);
  if (!Number.isFinite(emu) || emu <= 0) return null;

  // OOXML uses 914400 EMU/inch; CSS uses 96 px/inch.
  return Math.round((emu / 9_525) * 100) / 100;
}

function relationshipMap(xml: string | null): Map<string, Relationship> {
  if (xml === null) return new Map();
  const parsed = parser.parse(xml) as OrderedNode[];
  const relationships = findChildren(parsed, 'Relationship');
  const result = new Map<string, Relationship>();

  for (const relationship of relationships) {
    const id = attr(relationship, 'Id');
    const target = attr(relationship, 'Target');
    const type = attr(relationship, 'Type') ?? '';
    if (!id || !target || !type.endsWith('/image')) continue;

    result.set(id, { target, external: attr(relationship, 'TargetMode') === 'External' });
  }

  return result;
}

function safePackagePath(target: string): string | null {
  if (target.startsWith('/') || target.startsWith('\\') || /^[A-Za-z]:/.test(target)) return null;
  const resolved = posix.normalize(posix.join('word', target.replaceAll('\\', '/')));

  return resolved.startsWith('word/') && !resolved.includes('/../') ? resolved : null;
}

function mimeType(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';

  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

function drawingDimensions(drawing: OrderedNode[], floating: boolean): { width: number | null; height: number | null } {
  const containerKey = floating ? 'wp:anchor' : 'wp:inline';
  const container = firstChild(drawing, containerKey);
  const extent = container ? findChildren(container, 'wp:extent')[0] : undefined;

  return {
    width: extent ? emuToPixels(attr(extent, 'wp:cx') ?? attr(extent, 'cx')) : null,
    height: extent ? emuToPixels(attr(extent, 'wp:cy') ?? attr(extent, 'cy')) : null
  };
}

function imagesInRun(
  run: OrderedNode[],
  relationships: Map<string, Relationship>
): Omit<AnchoredImage, 'afterTextCharacters'>[] {
  const images: Omit<AnchoredImage, 'afterTextCharacters'>[] = [];

  for (const blip of findChildren(run, 'a:blip')) {
    const relationshipId = attr(blip, 'r:embed') ?? attr(blip, 'r:link');
    if (!relationshipId) continue;
    const relationship = relationships.get(relationshipId);
    if (!relationship || relationship.external) continue;
    const packagePath = safePackagePath(relationship.target);
    if (!packagePath) continue;

    const floating = findChildren(run, 'wp:anchor').length > 0;
    const dimensions = drawingDimensions(run, floating);
    images.push({ assetRef: `docx:${packagePath}`, ...dimensions, floating });
  }

  return images;
}

function imagesInParagraph(paragraph: OrderedNode[], relationships: Map<string, Relationship>): AnchoredImage[] {
  const images: AnchoredImage[] = [];
  let precedingText = 0;

  // Images can sit directly in `w:r`, under a hyperlink, or inside
  // AlternateContent. Walking the paragraph's ordered children keeps the run
  // position while recursion handles those wrappers.
  function walk(nodes: OrderedNode[]): void {
    for (const node of nodes) {
      const run = children(node, 'w:r');
      if (run.length > 0) {
        for (const image of imagesInRun(run, relationships)) {
          images.push({ ...image, afterTextCharacters: precedingText });
        }
        precedingText += wordText(run).length;
        continue;
      }

      for (const [key, value] of Object.entries(node)) {
        if (key === ':@' || !Array.isArray(value)) continue;
        walk(value as OrderedNode[]);
      }
    }
  }

  walk(paragraph);

  return images;
}

function cellProperties(cell: OrderedNode): { span: number; verticalMerge: 'restart' | 'continue' | null } {
  const content = children(cell, 'w:tc');
  const properties = firstChild(content, 'w:tcPr');
  if (!properties) return { span: 1, verticalMerge: null };

  const gridSpan = findChildren(properties, 'w:gridSpan')[0];
  const merge = findChildren(properties, 'w:vMerge')[0];
  const mergeValue = merge ? attr(merge, 'w:val') : undefined;

  return {
    span: Math.max(1, parseInteger(gridSpan ? attr(gridSpan, 'w:val') : undefined, 1)),
    verticalMerge: merge ? (mergeValue === 'restart' ? 'restart' : 'continue') : null
  };
}

function tableStructure(table: OrderedNode[], tableIndex: number, sourceBlockIndex: number): TableStructure {
  const rows = findChildren(table, 'w:tr');
  const result: TableCellOrigin[][] = [];
  const verticalOrigins = new Map<number, { row: number; column: number }>();

  rows.forEach((row, rowIndex) => {
    const rowContent = children(row, 'w:tr');
    // Preserve the `w:tc` wrapper: its attributes sit beside its content in a
    // preserve-order AST. Flattening to the content makes every child inside an
    // actual cell look like another physical cell.
    const cells = rowContent.filter((node) => Object.hasOwn(node, 'w:tc'));
    let gridColumn = 0;
    const output: TableCellOrigin[] = [];

    cells.forEach((cell, physicalColumn) => {
      const { span, verticalMerge } = cellProperties(cell);
      let origin = { row: rowIndex, column: gridColumn };

      if (verticalMerge === 'continue') {
        origin = verticalOrigins.get(gridColumn) ?? origin;
      } else if (verticalMerge === 'restart') {
        verticalOrigins.set(gridColumn, origin);
      } else {
        for (let column = gridColumn; column < gridColumn + span; column++) verticalOrigins.delete(column);
      }

      output.push({
        physicalColumn,
        column: gridColumn,
        originRow: origin.row,
        originColumn: origin.column
      });
      gridColumn += span;
    });

    result.push(output);
  });

  return { tableIndex, sourceBlockIndex, rows: result };
}

export async function readDocumentEnrichment(
  documentXml: string,
  relationsXml: string | null,
  pkg: DocxPackage
): Promise<DocumentEnrichment> {
  const relationships = relationshipMap(relationsXml);
  const parsed = parser.parse(documentXml) as OrderedNode[];
  const body = firstChild(parsed, 'w:body') ?? [];
  const bodyBlocks = body.filter((node) => children(node, 'w:p').length > 0 || children(node, 'w:tbl').length > 0);
  const imagesByBlock = new Map<number, AnchoredImage[]>();
  const tablesByBlock = new Map<number, TableStructure>();
  const assetPaths = new Set<string>();
  let tableIndex = 0;

  bodyBlocks.forEach((block, sourceBlockIndex) => {
    const paragraph = children(block, 'w:p');
    if (paragraph.length > 0) {
      const images = imagesInParagraph(paragraph, relationships);
      if (images.length > 0) {
        imagesByBlock.set(sourceBlockIndex, images);
        for (const image of images) assetPaths.add(image.assetRef.slice('docx:'.length));
      }
    }

    const table = children(block, 'w:tbl');
    if (table.length > 0) {
      tablesByBlock.set(sourceBlockIndex, tableStructure(table, tableIndex, sourceBlockIndex));
      tableIndex++;
    }
  });

  const assets: DocxEmbeddedAsset[] = [];
  for (const packagePath of [...assetPaths].sort()) {
    const bytes = await pkg.readBytes(packagePath);
    if (!bytes) continue;
    assets.push({ ref: `docx:${packagePath}`, packagePath, mimeType: mimeType(packagePath), bytes });
  }

  return { imagesByBlock, assets, tablesByBlock };
}
