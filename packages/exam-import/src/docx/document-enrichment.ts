import { posix } from 'node:path';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import type { DocxPackage } from './docx-package';
import { convertOmmlToLatex } from './omml-to-latex';
import { assertSafeXml, hasOwn } from './ordered-xml';

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

export type AnchoredMath = {
  /** Offset in the flattened text emitted by officeparser. */
  afterTextCharacters: number;
  /** Number of flattened characters replaced by the structured math run. */
  textCharacters: number;
  latex: string | null;
  omml: string | null;
  sourceText: string;
  reason: string | null;
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
  imagesByCell: Map<string, AnchoredImage[]>;
  mathByCell: Map<string, AnchoredMath[]>;
  nestedTableCount: number;
};

export type DocumentEnrichment = {
  /** Top-level paragraph index → drawings anchored in that paragraph. */
  imagesByBlock: Map<number, AnchoredImage[]>;
  mathByBlock: Map<number, AnchoredMath[]>;
  assets: DocxEmbeddedAsset[];
  externalImageRelationships: string[];
  missingImageAssets: string[];
  unresolvedImageRelationships: string[];
  tablesByBlock: Map<number, TableStructure>;
};

type OrderedNode = Record<string, unknown>;
type Relationship = { target: string; external: boolean };
type NamespaceDeclaration = { name: string; value: string };

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  processEntities: true,
  trimValues: false
});
const builder = new XMLBuilder({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: false
});
const MATH_NAMESPACE = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

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

function documentNamespaces(parsed: OrderedNode[]): NamespaceDeclaration[] {
  const document = parsed.find((node) => hasOwn(node, 'w:document'));
  const declarations = document
    ? Object.entries(attrs(document))
        .filter(([name, value]) => name.startsWith('@_xmlns') && typeof value === 'string')
        .map(([name, value]) => ({ name: name.slice(2), value: String(value) }))
    : [];
  if (!declarations.some((declaration) => declaration.name === 'xmlns:m')) {
    declarations.push({ name: 'xmlns:m', value: MATH_NAMESPACE });
  }

  return declarations.sort((left, right) => left.name.localeCompare(right.name));
}

/** Matching wrapper nodes, preserving attributes stored beside their content. */
function findChildren(nodes: OrderedNode[], key: string): OrderedNode[] {
  const found: OrderedNode[] = [];

  for (const node of nodes) {
    if (hasOwn(node, key)) found.push(node);
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
    if (
      hasOwn(node, 'w:drawing') ||
      hasOwn(node, 'w:pict') ||
      hasOwn(node, 'w:object') ||
      hasOwn(node, 'mc:AlternateContent')
    ) {
      continue;
    }

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

function officeMathText(nodes: OrderedNode[]): string {
  let text = '';

  for (const node of nodes) {
    const textContent = children(node, 'm:t');
    if (textContent.length > 0 || hasOwn(node, 'm:t')) {
      for (const item of textContent) {
        const value = item['#text'];
        if (typeof value === 'string' || typeof value === 'number') text += String(value);
      }
      continue;
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === ':@' || !Array.isArray(value)) continue;
      text += officeMathText(value as OrderedNode[]);
    }
  }

  return text;
}

function officeMathXml(
  node: OrderedNode,
  key: 'm:oMath' | 'm:oMathPara',
  namespaceDeclarations: NamespaceDeclaration[]
): string {
  const xml = builder.build([node]) as string;
  const opening = `<${key}`;
  const openingIndex = xml.indexOf(opening);
  if (openingIndex === -1) return xml;
  const insertionIndex = openingIndex + opening.length;
  const declarations = namespaceDeclarations
    .filter((declaration) => !xml.includes(`${declaration.name}=`))
    .map((declaration) => ` ${declaration.name}="${declaration.value}"`)
    .join('');

  return `${xml.slice(0, insertionIndex)}${declarations}${xml.slice(insertionIndex)}`;
}

function mathInNodes(nodes: OrderedNode[], namespaceDeclarations: NamespaceDeclaration[]): AnchoredMath[] {
  const maths: AnchoredMath[] = [];
  let precedingText = 0;

  function walk(content: OrderedNode[]): void {
    for (const node of content) {
      const mathKey = hasOwn(node, 'm:oMathPara') ? 'm:oMathPara' : hasOwn(node, 'm:oMath') ? 'm:oMath' : null;
      if (mathKey) {
        const flattenedText = officeMathText(children(node, mathKey));
        const conversion = convertOmmlToLatex([node]);
        maths.push({
          afterTextCharacters: precedingText,
          textCharacters: flattenedText.length,
          latex: conversion.success ? conversion.latex : null,
          omml: conversion.success ? null : officeMathXml(node, mathKey, namespaceDeclarations),
          sourceText: flattenedText,
          reason: conversion.success ? null : conversion.reason
        });
        precedingText += flattenedText.length;
        continue;
      }

      const normalText = children(node, 'w:t');
      if (normalText.length > 0 || hasOwn(node, 'w:t')) {
        for (const item of normalText) {
          const value = item['#text'];
          if (typeof value === 'string' || typeof value === 'number') precedingText += String(value).length;
        }
        continue;
      }

      for (const [key, value] of Object.entries(node)) {
        if (key === ':@' || !Array.isArray(value)) continue;
        walk(value as OrderedNode[]);
      }
    }
  }

  walk(nodes);

  return maths;
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
  if (
    target.startsWith('/') ||
    target.startsWith('\\') ||
    /^[A-Za-z]:/.test(target) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)
  ) {
    return null;
  }
  const resolved = posix.normalize(posix.join('word', target.replace(/\\/g, '/')));

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
  relationships: Map<string, Relationship>,
  externalImageRelationships: Set<string>,
  unresolvedImageRelationships: Set<string>
): Omit<AnchoredImage, 'afterTextCharacters'>[] {
  const images: Omit<AnchoredImage, 'afterTextCharacters'>[] = [];

  for (const blip of findChildren(run, 'a:blip')) {
    const relationshipId = attr(blip, 'r:embed') ?? attr(blip, 'r:link');
    if (!relationshipId) continue;
    const relationship = relationships.get(relationshipId);
    if (!relationship) {
      unresolvedImageRelationships.add(relationshipId);
      continue;
    }
    if (relationship.external) {
      externalImageRelationships.add(relationshipId);
      continue;
    }
    const packagePath = safePackagePath(relationship.target);
    if (!packagePath) {
      unresolvedImageRelationships.add(relationshipId);
      continue;
    }

    const floating = findChildren(run, 'wp:anchor').length > 0;
    const dimensions = drawingDimensions(run, floating);
    images.push({ assetRef: `docx:${packagePath}`, ...dimensions, floating });
  }

  return images;
}

function imagesInParagraph(
  paragraph: OrderedNode[],
  relationships: Map<string, Relationship>,
  externalImageRelationships: Set<string>,
  unresolvedImageRelationships: Set<string>
): AnchoredImage[] {
  const images: AnchoredImage[] = [];
  let precedingText = 0;

  // Images can sit directly in `w:r`, under a hyperlink, or inside
  // AlternateContent. Walking the paragraph's ordered children keeps the run
  // position while recursion handles those wrappers.
  function walk(nodes: OrderedNode[]): void {
    for (const node of nodes) {
      const mathKey = hasOwn(node, 'm:oMathPara') ? 'm:oMathPara' : hasOwn(node, 'm:oMath') ? 'm:oMath' : null;
      if (mathKey) {
        precedingText += officeMathText(children(node, mathKey)).length;
        continue;
      }

      const run = children(node, 'w:r');
      if (run.length > 0) {
        for (const image of imagesInRun(run, relationships, externalImageRelationships, unresolvedImageRelationships)) {
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

function cellProperties(cell: OrderedNode): {
  span: number;
  horizontalMerge: 'restart' | 'continue' | null;
  verticalMerge: 'restart' | 'continue' | null;
} {
  const content = children(cell, 'w:tc');
  const properties = firstChild(content, 'w:tcPr');
  if (!properties) return { span: 1, horizontalMerge: null, verticalMerge: null };

  const gridSpan = findChildren(properties, 'w:gridSpan')[0];
  const horizontalMerge = findChildren(properties, 'w:hMerge')[0];
  const verticalMerge = findChildren(properties, 'w:vMerge')[0];
  const horizontalMergeValue = horizontalMerge ? attr(horizontalMerge, 'w:val') : undefined;
  const verticalMergeValue = verticalMerge ? attr(verticalMerge, 'w:val') : undefined;

  return {
    span: Math.max(1, parseInteger(gridSpan ? attr(gridSpan, 'w:val') : undefined, 1)),
    horizontalMerge: horizontalMerge ? (horizontalMergeValue === 'restart' ? 'restart' : 'continue') : null,
    verticalMerge: verticalMerge ? (verticalMergeValue === 'restart' ? 'restart' : 'continue') : null
  };
}

function rowGridBefore(rowContent: OrderedNode[]): number {
  const properties = firstChild(rowContent, 'w:trPr');
  const gridBefore = properties ? findChildren(properties, 'w:gridBefore')[0] : undefined;

  return Math.max(0, parseInteger(gridBefore ? attr(gridBefore, 'w:val') : undefined));
}

function tableStructure(
  table: OrderedNode[],
  tableIndex: number,
  sourceBlockIndex: number,
  relationships: Map<string, Relationship>,
  externalImageRelationships: Set<string>,
  unresolvedImageRelationships: Set<string>,
  namespaceDeclarations: NamespaceDeclaration[]
): TableStructure {
  const rows = table.filter((node) => hasOwn(node, 'w:tr'));
  const result: TableCellOrigin[][] = [];
  const verticalOrigins = new Map<number, { row: number; column: number }>();
  const imagesByCell = new Map<string, AnchoredImage[]>();
  const mathByCell = new Map<string, AnchoredMath[]>();
  const nestedTableCount = findChildren(table, 'w:tbl').length;

  rows.forEach((row, rowIndex) => {
    const rowContent = children(row, 'w:tr');
    // Preserve the `w:tc` wrapper: its attributes sit beside its content in a
    // preserve-order AST. Flattening to the content makes every child inside an
    // actual cell look like another physical cell.
    const cells = rowContent.filter((node) => hasOwn(node, 'w:tc'));
    let gridColumn = rowGridBefore(rowContent);
    let horizontalOrigin: { row: number; column: number } | null = null;
    const output: TableCellOrigin[] = [];

    cells.forEach((cell, physicalColumn) => {
      const cellContent = children(cell, 'w:tc');
      const images = imagesInParagraph(
        cellContent,
        relationships,
        externalImageRelationships,
        unresolvedImageRelationships
      );
      const maths = mathInNodes(cellContent, namespaceDeclarations);
      if (images.length > 0) imagesByCell.set(`${rowIndex}:${physicalColumn}`, images);
      if (maths.length > 0) mathByCell.set(`${rowIndex}:${physicalColumn}`, maths);
      const { span, horizontalMerge, verticalMerge } = cellProperties(cell);
      let origin = { row: rowIndex, column: gridColumn };

      if (verticalMerge === 'continue') {
        origin = verticalOrigins.get(gridColumn) ?? origin;
      } else if (verticalMerge === 'restart') {
        for (let column = gridColumn; column < gridColumn + span; column++) verticalOrigins.set(column, origin);
      } else {
        for (let column = gridColumn; column < gridColumn + span; column++) verticalOrigins.delete(column);
      }

      if (horizontalMerge === 'continue') {
        origin = horizontalOrigin ?? origin;
      } else if (horizontalMerge === 'restart') {
        horizontalOrigin = origin;
      } else {
        horizontalOrigin = null;
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

  return { tableIndex, sourceBlockIndex, rows: result, imagesByCell, mathByCell, nestedTableCount };
}

export async function readDocumentEnrichment(
  documentXml: string,
  relationsXml: string | null,
  pkg: DocxPackage
): Promise<DocumentEnrichment> {
  assertSafeXml(documentXml);
  if (relationsXml !== null) assertSafeXml(relationsXml);
  const relationships = relationshipMap(relationsXml);
  const parsed = parser.parse(documentXml) as OrderedNode[];
  const namespaceDeclarations = documentNamespaces(parsed);
  const body = firstChild(parsed, 'w:body') ?? [];
  const bodyBlocks = body.filter((node) => children(node, 'w:p').length > 0 || children(node, 'w:tbl').length > 0);
  const imagesByBlock = new Map<number, AnchoredImage[]>();
  const mathByBlock = new Map<number, AnchoredMath[]>();
  const tablesByBlock = new Map<number, TableStructure>();
  const assetPaths = new Set<string>();
  const externalImageRelationships = new Set<string>();
  const unresolvedImageRelationships = new Set<string>();
  let tableIndex = 0;

  bodyBlocks.forEach((block, sourceBlockIndex) => {
    const paragraph = children(block, 'w:p');
    if (paragraph.length > 0) {
      const images = imagesInParagraph(
        paragraph,
        relationships,
        externalImageRelationships,
        unresolvedImageRelationships
      );
      const maths = mathInNodes(paragraph, namespaceDeclarations);
      if (images.length > 0) {
        imagesByBlock.set(sourceBlockIndex, images);
        for (const image of images) assetPaths.add(image.assetRef.slice('docx:'.length));
      }
      if (maths.length > 0) mathByBlock.set(sourceBlockIndex, maths);
    }

    const table = children(block, 'w:tbl');
    if (table.length > 0) {
      const structure = tableStructure(
        table,
        tableIndex,
        sourceBlockIndex,
        relationships,
        externalImageRelationships,
        unresolvedImageRelationships,
        namespaceDeclarations
      );
      tablesByBlock.set(sourceBlockIndex, structure);
      for (const images of structure.imagesByCell.values()) {
        for (const image of images) assetPaths.add(image.assetRef.slice('docx:'.length));
      }
      tableIndex++;
    }
  });

  const assets: DocxEmbeddedAsset[] = [];
  for (const packagePath of [...assetPaths].sort()) {
    const bytes = await pkg.readBytes(packagePath);
    if (!bytes) continue;
    assets.push({ ref: `docx:${packagePath}`, packagePath, mimeType: mimeType(packagePath), bytes });
  }
  const availableAssets = new Set(assets.map((asset) => asset.ref));
  const missingImageAssets = [...assetPaths]
    .map((packagePath) => `docx:${packagePath}`)
    .filter((assetRef) => !availableAssets.has(assetRef))
    .sort();

  for (const [blockIndex, images] of imagesByBlock) {
    const availableImages = images.filter((image) => availableAssets.has(image.assetRef));
    if (availableImages.length > 0) {
      imagesByBlock.set(blockIndex, availableImages);
    } else {
      imagesByBlock.delete(blockIndex);
    }
  }
  for (const table of tablesByBlock.values()) {
    for (const [cell, images] of table.imagesByCell) {
      const availableImages = images.filter((image) => availableAssets.has(image.assetRef));
      if (availableImages.length > 0) {
        table.imagesByCell.set(cell, availableImages);
      } else {
        table.imagesByCell.delete(cell);
      }
    }
  }

  return {
    imagesByBlock,
    mathByBlock,
    assets,
    externalImageRelationships: [...externalImageRelationships].sort(),
    missingImageAssets,
    unresolvedImageRelationships: [...unresolvedImageRelationships].sort(),
    tablesByBlock
  };
}
