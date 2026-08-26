import { parseOffice } from 'officeparser';
import { emptyFormatting, type BlockContext, type RunFormatting, type SourceRun } from '../source-run';
import {
  readDocumentEnrichment,
  type AnchoredImage,
  type AnchoredMath,
  type DocxEmbeddedAsset,
  type TableCellOrigin
} from './document-enrichment';
import { getTableCellFormatting, readDocumentFormatting, type FormattingSegment } from './docx-formatting';
import { DOCX_PART, openDocxPackage, type DocxPackageLimits } from './docx-package';
import { renderListLabelForCounter } from './list-label';
import { findListLevel, parseNumberingDefinitions, type ListDefinitions } from './numbering-definitions';
import { assertSafeXml } from './ordered-xml';

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
  | 'UNSUPPORTED_OFFICE_MATH'
  | 'FORMATTING_ALIGNMENT_FAILED'
  | 'EXTERNAL_IMAGE_NOT_EMBEDDED'
  | 'MISSING_IMAGE_ASSET'
  | 'UNRESOLVED_IMAGE_RELATIONSHIP'
  | 'NESTED_TABLE_STRUCTURE_FLATTENED'
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
    highlight: readColour(formatting, 'backgroundColor')
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

/**
 * officeparser renders Office Math as its own node holding a LaTeX rendering. The
 * OOXML side supplies those runs with their own conversion, so the placeholder text
 * must stay out of the text stream that anchors offsets.
 */
function isMathNode(node: OfficeNode): boolean {
  return node.metadata?.math !== undefined;
}

function collectTextRuns(node: OfficeNode): OfficeNode[] {
  const children = node.children ?? [];
  if (children.length === 0) {
    return typeof node.text === 'string' && node.text.length > 0 && !isMathNode(node) ? [node] : [];
  }

  return children.flatMap((child) =>
    child.children && child.children.length > 0
      ? collectTextRuns(child)
      : child.text && !isMathNode(child)
        ? [child]
        : []
  );
}

function collectTableCells(node: OfficeNode): Array<{ cell: OfficeNode; row: number; physicalColumn: number }> {
  return (node.children ?? [])
    .filter((child) => child.type === 'row')
    .flatMap((row, rowIndex) =>
      (row.children ?? [])
        .filter((child) => child.type === 'cell')
        .map((cell, physicalColumn) => ({ cell, row: rowIndex, physicalColumn }))
    );
}

type RunEntry =
  | { kind: 'text'; node: OfficeNode; formatting?: RunFormatting }
  | {
      kind: 'image';
      image: { assetRef: string; width: number | null; height: number | null; floating: boolean };
    }
  | { kind: 'math'; math: NonNullable<SourceRun['math']> };

type InlineEvent =
  | { kind: 'image'; offset: number; order: number; image: AnchoredImage }
  | {
      kind: 'math';
      offset: number;
      order: number;
      textCharacters: number;
      math: NonNullable<SourceRun['math']>;
    };

function sourceMath(math: AnchoredMath): NonNullable<SourceRun['math']> {
  if (math.latex !== null) return { latex: math.latex };
  if (math.omml === null || math.reason === null) {
    throw new Error('Unsupported Office Math is missing its preserved OMML source');
  }

  return {
    latex: null,
    omml: math.omml,
    sourceText: math.sourceText,
    reason: math.reason
  };
}

function appendTextRange(entries: RunEntry[], textRuns: OfficeNode[], start: number, end: number): void {
  if (end <= start) return;
  let offset = 0;

  for (const node of textRuns) {
    const text = node.text ?? '';
    const nodeEnd = offset + text.length;
    const sliceStart = Math.max(start, offset);
    const sliceEnd = Math.min(end, nodeEnd);
    if (sliceStart < sliceEnd) {
      entries.push({
        kind: 'text',
        node: { ...node, text: text.slice(sliceStart - offset, sliceEnd - offset) }
      });
    }
    offset = nodeEnd;
    if (offset >= end) return;
  }
}

function interleaveInlineContent(textRuns: OfficeNode[], images: AnchoredImage[], maths: AnchoredMath[]): RunEntry[] {
  const events: InlineEvent[] = [
    ...images.map(
      (image, order): InlineEvent => ({
        kind: 'image',
        offset: image.afterTextCharacters,
        order,
        image
      })
    ),
    ...maths.map(
      (math, order): InlineEvent => ({
        kind: 'math',
        offset: math.afterTextCharacters,
        order: images.length + order,
        textCharacters: math.textCharacters,
        math: sourceMath(math)
      })
    )
  ].sort((left, right) => left.offset - right.offset || left.order - right.order);
  const entries: RunEntry[] = [];
  const totalTextCharacters = textRuns.reduce((total, node) => total + (node.text?.length ?? 0), 0);
  let cursor = 0;

  for (const event of events) {
    const offset = Math.max(cursor, Math.min(event.offset, totalTextCharacters));
    appendTextRange(entries, textRuns, cursor, offset);
    if (event.kind === 'image') {
      entries.push({ kind: 'image', image: event.image });
    } else {
      entries.push({ kind: 'math', math: event.math });
      cursor = Math.max(cursor, Math.min(event.offset + event.textCharacters, totalTextCharacters));
    }
    if (event.kind === 'image') cursor = offset;
  }

  appendTextRange(entries, textRuns, cursor, totalTextCharacters);

  return entries;
}

function applyEffectiveFormatting(
  entries: RunEntry[],
  segments: FormattingSegment[]
): { entries: RunEntry[]; aligned: boolean } {
  const entryText = entries
    .filter((entry): entry is Extract<RunEntry, { kind: 'text' }> => entry.kind === 'text')
    .map((entry) => entry.node.text ?? '')
    .join('');
  const segmentText = segments.map((segment) => segment.text).join('');
  if (entryText !== segmentText) return { entries, aligned: false };

  const formatted: RunEntry[] = [];
  let segmentIndex = 0;
  let segmentOffset = 0;

  for (const entry of entries) {
    if (entry.kind !== 'text') {
      formatted.push(entry);
      continue;
    }

    const text = entry.node.text ?? '';
    let textOffset = 0;
    while (textOffset < text.length) {
      const segment = segments[segmentIndex];
      if (!segment) return { entries, aligned: false };
      const available = segment.text.length - segmentOffset;
      const length = Math.min(text.length - textOffset, available);
      formatted.push({
        kind: 'text',
        node: { ...entry.node, text: text.slice(textOffset, textOffset + length) },
        formatting: segment.formatting
      });
      textOffset += length;
      segmentOffset += length;
      if (segmentOffset === segment.text.length) {
        segmentIndex++;
        segmentOffset = 0;
      }
    }
  }

  return { entries: formatted, aligned: segmentIndex === segments.length && segmentOffset === 0 };
}

function appendSourceRuns(
  entries: RunEntry[],
  block: BlockContext,
  outputBlockIndex: number,
  runs: SourceRun[],
  warnings: DocxReadWarning[]
): void {
  entries.forEach((entry, runIndex) => {
    if (entry.kind === 'text') {
      runs.push({
        text: entry.node.text ?? '',
        formatting: entry.formatting ?? readFormatting(entry.node),
        block,
        math: null,
        image: null,
        location: { blockIndex: outputBlockIndex, runIndex }
      });
      return;
    }

    if (entry.kind === 'math') {
      runs.push({
        text: '',
        formatting: emptyFormatting(),
        block,
        math: entry.math,
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
}

function appendMathWarnings(maths: AnchoredMath[], blockIndex: number, warnings: DocxReadWarning[]): void {
  for (const math of maths) {
    if (math.reason === null) continue;
    warnings.push({
      code: 'UNSUPPORTED_OFFICE_MATH',
      message: `Block ${blockIndex} contains Office Math preserved as OMML for review: ${math.reason}`,
      blockIndex
    });
  }
}

export async function readDocxRuns(data: Uint8Array, limits?: DocxPackageLimits): Promise<DocxReadResult> {
  const pkg = await openDocxPackage(data, limits);
  for (const part of pkg.entryNames()) {
    if (!part.endsWith('.xml') && !part.endsWith('.rels')) continue;
    const xml = await pkg.readText(part);
    if (xml !== null) assertSafeXml(xml);
  }

  const [numberingXml, documentXmlValue, relationsXml, stylesXml, themeXml] = await Promise.all([
    pkg.readText(DOCX_PART.numbering),
    pkg.readText(DOCX_PART.document),
    pkg.readText(DOCX_PART.documentRelations),
    pkg.readText(DOCX_PART.styles),
    pkg.readText(DOCX_PART.theme)
  ]);
  const definitions = numberingXml === null ? new Map() : parseNumberingDefinitions(numberingXml);
  const documentXml = documentXmlValue!;
  const enrichment = await readDocumentEnrichment(documentXml, relationsXml, pkg);
  const documentFormatting = readDocumentFormatting(documentXml, stylesXml, themeXml);
  const officeParserBytes = await pkg.bytesForOfficeParser();

  const ast = (await parseOffice(Buffer.from(officeParserBytes))) as { content?: OfficeNode[] };
  const nodes = ast.content ?? [];

  const runs: SourceRun[] = [];
  const warnings: DocxReadWarning[] = [];
  let outputBlockIndex = 0;

  for (const relationshipId of enrichment.externalImageRelationships) {
    warnings.push({
      code: 'EXTERNAL_IMAGE_NOT_EMBEDDED',
      message: `External image relationship ${relationshipId} was not fetched or emitted`,
      blockIndex: null
    });
  }
  for (const assetRef of enrichment.missingImageAssets) {
    warnings.push({
      code: 'MISSING_IMAGE_ASSET',
      message: `Image relationship ${assetRef} has no package bytes and was not emitted`,
      blockIndex: null
    });
  }
  for (const relationshipId of enrichment.unresolvedImageRelationships) {
    warnings.push({
      code: 'UNRESOLVED_IMAGE_RELATIONSHIP',
      message: `Image relationship ${relationshipId} could not resolve to a safe package part`,
      blockIndex: null
    });
  }

  nodes.forEach((node, sourceBlockIndex) => {
    if (node.type === 'table') {
      const table = enrichment.tablesByBlock.get(sourceBlockIndex);
      const parsedCells = collectTableCells(node);
      const parsedCellsByPosition = new Map<string, OfficeNode>();
      parsedCells.forEach(({ cell, row, physicalColumn }) => {
        parsedCellsByPosition.set(`${row}:${physicalColumn}`, cell);
      });
      if (table && table.nestedTableCount > 0) {
        warnings.push({
          code: 'NESTED_TABLE_STRUCTURE_FLATTENED',
          message: `Table ${table.tableIndex} contains ${table.nestedTableCount} nested table(s) whose text was flattened into the parent cell`,
          blockIndex: outputBlockIndex
        });
      }
      const cells: Array<{
        cell: OfficeNode | null;
        row: number;
        physicalColumn: number;
        origin: TableCellOrigin | null;
      }> = table
        ? table.rows.flatMap((row, rowIndex) =>
            row.map((origin) => ({
              cell: parsedCellsByPosition.get(`${rowIndex}:${origin.physicalColumn}`) ?? null,
              row: rowIndex,
              physicalColumn: origin.physicalColumn,
              origin
            }))
          )
        : parsedCells.map(({ cell, row, physicalColumn }) => ({
            cell,
            row,
            physicalColumn,
            origin: null
          }));

      cells.forEach(({ cell, row, physicalColumn, origin }) => {
        const textRuns = cell ? collectTextRuns(cell) : [];
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
        const images = table?.imagesByCell.get(`${row}:${physicalColumn}`) ?? [];
        const maths = table?.mathByCell.get(`${row}:${physicalColumn}`) ?? [];
        appendMathWarnings(maths, outputBlockIndex, warnings);
        const inlineEntries = interleaveInlineContent(textRuns, images, maths);
        const formattingSegments = getTableCellFormatting(documentFormatting, sourceBlockIndex, row, physicalColumn);
        const formatted = applyEffectiveFormatting(inlineEntries, formattingSegments);
        if (!formatted.aligned && maths.every((math) => math.reason === null)) {
          warnings.push({
            code: 'FORMATTING_ALIGNMENT_FAILED',
            message: `Block ${outputBlockIndex} could not align OOXML formatting with extracted table text`,
            blockIndex: outputBlockIndex
          });
        }
        appendSourceRuns(formatted.entries, block, outputBlockIndex, runs, warnings);

        // Empty cells still need a block so table coordinates and merge
        // continuations survive into the answer-table parser.
        if (formatted.entries.length === 0) {
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
    const maths = enrichment.mathByBlock.get(sourceBlockIndex) ?? [];
    if (textRuns.length === 0 && images.length === 0 && maths.length === 0) return;

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
    appendMathWarnings(maths, outputBlockIndex, warnings);
    const inlineEntries = interleaveInlineContent(textRuns, images, maths);
    const formattingSegments = documentFormatting.paragraphsByBlock.get(sourceBlockIndex) ?? [];
    const formatted = applyEffectiveFormatting(inlineEntries, formattingSegments);
    if (!formatted.aligned && maths.every((math) => math.reason === null)) {
      warnings.push({
        code: 'FORMATTING_ALIGNMENT_FAILED',
        message: `Block ${outputBlockIndex} could not align OOXML formatting with extracted paragraph text`,
        blockIndex: outputBlockIndex
      });
    }
    appendSourceRuns(formatted.entries, block, outputBlockIndex, runs, warnings);

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
