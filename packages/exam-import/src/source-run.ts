import * as z from 'zod';

/**
 * The single seam every document reader produces and every downstream stage
 * consumes. A `.docx` reader, a text `.pdf` reader, and the scanned-page branch
 * all emit this shape, so segmentation never learns which format it came from.
 *
 * Every field is required. A reader that cannot determine a value states `null`
 * rather than omitting the key, because downstream code must be able to tell
 * "not underlined" apart from "underline unknown". Omission would silently
 * collapse those two into the same thing, and the answer key is exactly what
 * rides on that distinction.
 */

/** Where a run came from, for showing the teacher the source of a decision. */
const sourceLocationSchema = z.strictObject({
  /** Zero-based index of the block in document order. */
  blockIndex: z.number().int().min(0),
  /** Zero-based index of the run inside its block. */
  runIndex: z.number().int().min(0)
});

/**
 * Character offsets were the original intent, but no reader available to us
 * exposes them: the DOCX layer reports nodes and runs, and a rendered page has
 * no character stream at all. Block and run coordinates are what every reader
 * can actually produce, and they are enough to quote the source back.
 */
export type SourceLocation = z.infer<typeof sourceLocationSchema>;

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

const runFormattingSchema = z.strictObject({
  bold: z.boolean(),
  italic: z.boolean(),
  underline: z.boolean(),
  strikethrough: z.boolean(),
  /** Resolved to `#RRGGBB`; theme colours are resolved before they get here. */
  color: z.string().regex(HEX_COLOR).nullable(),
  /** Highlight/background. `null` when the reader cannot report it at all. */
  highlight: z.string().regex(HEX_COLOR).nullable()
});

export type RunFormatting = z.infer<typeof runFormattingSchema>;

const tableReferenceSchema = z.strictObject({
  tableIndex: z.number().int().min(0),
  /** Physical position of this cell in the source table. */
  row: z.number().int().min(0),
  column: z.number().int().min(0),
  /**
   * Merged continuation cells point at the cell that owns their content.
   * Ordinary cells point at themselves. Keeping both coordinates prevents an
   * answer-table parser from treating a continuation as a second answer while
   * still letting the review UI highlight the physical source cell.
   */
  originRow: z.number().int().min(0),
  originColumn: z.number().int().min(0)
});

const blockContextSchema = z.strictObject({
  kind: z.enum(['paragraph', 'table_cell', 'list_item']),
  /** Block position in document order. Matches `location.blockIndex`. */
  index: z.number().int().min(0),
  /**
   * The list label as it renders — `"A."`, `"b."`, `"1."`. Word stores this in
   * `numbering.xml` rather than in the text, so a reader that skips numbering
   * resolution loses every option label on an auto-numbered question.
   */
  listNumber: z.string().nullable(),
  tableRef: tableReferenceSchema.nullable()
});

export type BlockContext = z.infer<typeof blockContextSchema>;

const runMathSchema = z.strictObject({ latex: z.string().min(1) });

const runImageSchema = z.strictObject({
  /** Identifier the reader assigns; resolved to a stored asset later. */
  assetRef: z.string().min(1),
  width: z.number().positive().nullable(),
  height: z.number().positive().nullable(),
  /**
   * Inline images have a precise text position. Floating drawings are anchored
   * to the paragraph but their visual coordinates live outside text flow; the
   * distinction prevents downstream code from pretending it knows a position
   * Word never expressed in characters.
   */
  placement: z.enum(['inline', 'floating'])
});

export const sourceRunSchema = z.strictObject({
  text: z.string(),
  formatting: runFormattingSchema,
  block: blockContextSchema,
  math: runMathSchema.nullable(),
  image: runImageSchema.nullable(),
  location: sourceLocationSchema
});

export type SourceRun = z.infer<typeof sourceRunSchema>;

export const sourceRunStreamSchema = z.array(sourceRunSchema);

/** Formatting with every mark off and no colour. Readers start here and set what they find. */
export function emptyFormatting(): RunFormatting {
  return {
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    color: null,
    highlight: null
  };
}

/**
 * Text normalization used whenever two pieces of document text are compared —
 * matching an extraction against a reference, or an answer against a key.
 *
 * Unicode is normalized to NFC first: the same Vietnamese syllable can arrive
 * either precomposed or as a base letter plus a combining mark depending on the
 * producing tool, and those compare unequal byte-wise while being identical to
 * a reader.
 */
export function normalizeComparableText(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}
