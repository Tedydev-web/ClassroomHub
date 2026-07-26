import { parseOffice } from 'officeparser';
import { emptyFormatting, type BlockContext, type RunFormatting, type SourceRun } from '../source-run';
import { readDocumentEnrichment, type DocxEmbeddedAsset } from './document-enrichment';
import { DOCX_PART, openDocxPackage, type DocxPackageLimits } from './docx-package';
import { renderListLabelForCounter } from './list-label';
import { findListLevel, parseNumberingDefinitions, type ListDefinitions } from './numbering-definitions';

/**
 * Reads a `.docx` into the normalized run stream everything downstream
 * consumes.
 *
 * officeparser supplies text, per-run formatting and list identity, all of
 * which it recovers correctly on real scan-converted files. It does not supply
 * rendered list labels, images, tables or Office Math, so those come from a
 * direct pass over the package — or, where they are not implemented yet, from a
 * warning. Losing content silently is the one outcome this must not have.
 */

export type DocxReadWarningCode =
  | 'UNRESOLVED_LIST_LABEL'
  | 'FLOATING_IMAGE_POSITION_APPROXIMATE'
  | 'UNRECOGNISED_COLOUR'
  | 'EMPTY_DOCUMENT';

export type DocxReadWarning = {
  code: DocxReadWarningCode;
  message: string;
  /** Block the warning belongs to, when it is about one. */
  blockIndex: number | null;
};

export type DocxReadResult = {
  runs: SourceRun[];
  /** Bytes for every image referenced by a run, ready for the asset pipeline. */
  assets: DocxEmbeddedAsset[];
  /** Everything the reader could not represent. Never empty on a lossy read. */
  warnings: DocxReadWarning[];
};

type OfficeNode = {
  type?: string;
  text?: string;
  children?: OfficeNode[];
  formatting?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

function readBoolean(source: Record<string, unknown> | undefined, key: string): boolean {
  return source?.[key] === true;
}

/**
 * Colours arrive as `#RRGGBB` from officeparser, but `auto` and theme names
 * also occur. Anything not a concrete triplet becomes `null` so downstream code
 * never compares a colour it cannot interpret.
 */
function readColour(source: Record<string, unknown> | undefined, key: string): string | null {
  const value = source?.[key];
  if (typeof value !== 'string') return null;

  return HEX_COLOR.test(value) ? value : null;
}

function readFormatting(node: OfficeNode): RunFormatting {
  const formatting = node.formatting;

  return {
    ...emptyFormatting(),
    bold: readBoolean(formatting, 'bold'),
    italic: readBoolean(formatting, 'italic'),
    underline: readBoolean(formatting, 'underline'),
    strikethrough: readBoolean(formatting, 'strikethrough'),
    color: readColour(formatting, 'color'),
    // officeparser exposes no highlight at all, so "unknown" is the honest
    // value. Reporting `false` would claim the document was checked for it.
    highlight: null
  };
}

function blockKindOf(node: OfficeNode): BlockContext['kind'] {
  return node.type === 'list' ? 'list_item' : 'paragraph';
}

/**
 * Resolves the label Word renders for a list paragraph.
 *
 * officeparser's `itemIndex` is the counter minus one, with the level's `start`
 * already applied, so the counter is simply one more than it.
 */
function resolveListNumber(
  node: OfficeNode,
  definitions: ListDefinitions
): { label: string | null; unresolved: boolean } {
  if (node.type !== 'list') return { label: null, unresolved: false };

  const listId = node.metadata?.listId;
  const itemIndex = node.metadata?.itemIndex;
  const indentLevel = typeof node.metadata?.level === 'number' ? (node.metadata.level as number) : 0;
  if (listId === undefined || typeof itemIndex !== 'number') return { label: null, unresolved: true };

  const level = findListLevel(definitions, String(listId), indentLevel);
  if (!level) return { label: null, unresolved: true };

  const label = renderListLabelForCounter(level, itemIndex + 1);

  return { label, unresolved: label === null && level.format !== 'none' };
}

function collectTextRuns(node: OfficeNode): OfficeNode[] {
  const children = node.children ?? [];
  if (children.length === 0) {
    return typeof node.text === 'string' && node.text.length > 0 ? [node] : [];
  }

  return children.flatMap((child) =>
    child.children && child.children.length > 0 ? collectTextRuns(child) : child.text ? [child] : []
  );
}

function collectTableCells(node: OfficeNode): OfficeNode[] {
  if (node.type === 'cell') return [node];

  return (node.children ?? []).flatMap(collectTableCells);
}

type RunEntry =
  | { kind: 'text'; node: OfficeNode }
  | {
      kind: 'image';
      image: { assetRef: string; width: number | null; height: number | null; floating: boolean };
    };

function interleaveImages(
  textRuns: OfficeNode[],
  images: Array<{
    assetRef: string;
    afterTextCharacters: number;
    width: number | null;
    height: number | null;
    floating: boolean;
  }>
): RunEntry[] {
  const sortedImages = images
    .map((image, order) => ({ image, order }))
    .sort(
      (left, right) => left.image.afterTextCharacters - right.image.afterTextCharacters || left.order - right.order
    );
  const entries: RunEntry[] = [];
  let textCharacters = 0;
  let imageIndex = 0;

  for (const textRun of textRuns) {
    while (imageIndex < sortedImages.length && sortedImages[imageIndex]!.image.afterTextCharacters <= textCharacters) {
      entries.push({ kind: 'image', image: sortedImages[imageIndex]!.image });
      imageIndex++;
    }

    entries.push({ kind: 'text', node: textRun });
    textCharacters += textRun.text?.length ?? 0;
  }

  while (imageIndex < sortedImages.length) {
    entries.push({ kind: 'image', image: sortedImages[imageIndex]!.image });
    imageIndex++;
  }

  return entries;
}

export async function readDocxRuns(data: Uint8Array, limits?: DocxPackageLimits): Promise<DocxReadResult> {
  const pkg = await openDocxPackage(data, limits);
  const numberingXml = await pkg.readText(DOCX_PART.numbering);
  const definitions = numberingXml === null ? new Map() : parseNumberingDefinitions(numberingXml);
  const documentXml = (await pkg.readText(DOCX_PART.document))!;
  const enrichment = await readDocumentEnrichment(documentXml, await pkg.readText(DOCX_PART.documentRelations), pkg);

  const ast = (await parseOffice(Buffer.from(data))) as { content?: OfficeNode[] };
  const nodes = ast.content ?? [];

  const runs: SourceRun[] = [];
  const warnings: DocxReadWarning[] = [];
  let outputBlockIndex = 0;

  nodes.forEach((node, sourceBlockIndex) => {
    if (node.type === 'table') {
      const table = enrichment.tablesByBlock.get(sourceBlockIndex);
      const cells = collectTableCells(node);

      cells.forEach((cell, cellIndex) => {
        const textRuns = collectTextRuns(cell);
        const row = typeof cell.metadata?.row === 'number' ? (cell.metadata.row as number) : 0;
        const physicalColumn = typeof cell.metadata?.col === 'number' ? (cell.metadata.col as number) : cellIndex;
        const origin = table?.rows[row]?.find((entry) => entry.physicalColumn === physicalColumn);
        const column = origin?.column ?? physicalColumn;
        const block: BlockContext = {
          kind: 'table_cell',
          index: outputBlockIndex,
          listNumber: null,
          tableRef: {
            tableIndex: table?.tableIndex ?? 0,
            row,
            column,
            originRow: origin?.originRow ?? row,
            originColumn: origin?.originColumn ?? column
          }
        };

        textRuns.forEach((textRun, runIndex) => {
          runs.push({
            text: textRun.text ?? '',
            formatting: readFormatting(textRun),
            block,
            math: null,
            image: null,
            location: { blockIndex: outputBlockIndex, runIndex }
          });
        });

        // Empty cells still need a block so table coordinates and merge
        // continuations survive into the answer-table parser.
        if (textRuns.length === 0) {
          runs.push({
            text: '',
            formatting: emptyFormatting(),
            block,
            math: null,
            image: null,
            location: { blockIndex: outputBlockIndex, runIndex: 0 }
          });
        }

        outputBlockIndex++;
      });
      return;
    }

    const textRuns = collectTextRuns(node);
    const images = enrichment.imagesByBlock.get(sourceBlockIndex) ?? [];
    if (textRuns.length === 0 && images.length === 0) return;

    const listNumber = resolveListNumber(node, definitions);
    if (listNumber.unresolved) {
      warnings.push({
        code: 'UNRESOLVED_LIST_LABEL',
        message: `Block ${outputBlockIndex} is an automatically numbered item whose label could not be resolved`,
        blockIndex: outputBlockIndex
      });
    }

    const block: BlockContext = {
      kind: blockKindOf(node),
      index: outputBlockIndex,
      listNumber: listNumber.label,
      tableRef: null
    };
    const entries = interleaveImages(textRuns, images);

    entries.forEach((entry, runIndex) => {
      if (entry.kind === 'text') {
        runs.push({
          text: entry.node.text ?? '',
          formatting: readFormatting(entry.node),
          block,
          math: null,
          image: null,
          location: { blockIndex: outputBlockIndex, runIndex }
        });
        return;
      }

      runs.push({
        text: '',
        formatting: emptyFormatting(),
        block,
        math: null,
        image: {
          assetRef: entry.image.assetRef,
          width: entry.image.width,
          height: entry.image.height,
          placement: entry.image.floating ? 'floating' : 'inline'
        },
        location: { blockIndex: outputBlockIndex, runIndex }
      });
      if (entry.image.floating) {
        warnings.push({
          code: 'FLOATING_IMAGE_POSITION_APPROXIMATE',
          message: `Block ${outputBlockIndex} contains a floating image whose exact visual position is not part of text flow`,
          blockIndex: outputBlockIndex
        });
      }
    });

    outputBlockIndex++;
  });

  if (runs.length === 0) {
    warnings.push({
      code: 'EMPTY_DOCUMENT',
      message: 'No text or images were recovered from the document',
      blockIndex: null
    });
  }

  return { runs, assets: enrichment.assets, warnings };
}
