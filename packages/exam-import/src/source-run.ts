import { MAX_AUTHORED_HTML_LENGTH, MAX_FILE_KEY_LENGTH } from '@cio/question-types';
import * as z from 'zod';

export const MAX_SOURCE_RUNS = 100_000;
export const MAX_SOURCE_RUN_TEXT_LENGTH = MAX_AUTHORED_HTML_LENGTH;
export const MAX_SOURCE_STREAM_TEXT_LENGTH = 100 * 1024 * 1024;
const MAX_SOURCE_LIST_LABEL_LENGTH = 64;
const MAX_SOURCE_REASON_LENGTH = 2_000;

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
  listNumber: z.string().max(MAX_SOURCE_LIST_LABEL_LENGTH).nullable(),
  tableRef: tableReferenceSchema.nullable()
});

export type BlockContext = z.infer<typeof blockContextSchema>;

const runMathSchema = z.union([
  z.strictObject({ latex: z.string().min(1).max(MAX_SOURCE_RUN_TEXT_LENGTH) }),
  z.strictObject({
    latex: z.null(),
    /** Canonicalized source retained for review and the later image/AI branch. */
    omml: z.string().min(1).max(MAX_SOURCE_RUN_TEXT_LENGTH),
    sourceText: z.string().max(MAX_SOURCE_RUN_TEXT_LENGTH),
    reason: z.string().min(1).max(MAX_SOURCE_REASON_LENGTH)
  })
]);

const runImageSchema = z.strictObject({
  /** Identifier the reader assigns; resolved to a stored asset later. */
  assetRef: z.string().min(1).max(MAX_FILE_KEY_LENGTH),
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

export const sourceRunSchema = z
  .strictObject({
    text: z.string().max(MAX_SOURCE_RUN_TEXT_LENGTH),
    formatting: runFormattingSchema,
    block: blockContextSchema,
    math: runMathSchema.nullable(),
    image: runImageSchema.nullable(),
    location: sourceLocationSchema
  })
  .superRefine((run, context) => {
    if (run.block.index !== run.location.blockIndex) {
      context.addIssue({
        code: 'custom',
        path: ['location', 'blockIndex'],
        message: 'Source location block index must match its block context'
      });
    }
  });

export type SourceRun = z.infer<typeof sourceRunSchema>;

function sourceRunPayloadLength(run: SourceRun): number {
  const mathLength =
    run.math === null
      ? 0
      : run.math.latex === null
        ? run.math.omml.length + run.math.sourceText.length + run.math.reason.length
        : run.math.latex.length;

  return run.text.length + (run.block.listNumber?.length ?? 0) + mathLength + (run.image?.assetRef.length ?? 0);
}

export const sourceRunStreamSchema = z
  .array(sourceRunSchema)
  .max(MAX_SOURCE_RUNS)
  .superRefine((runs, context) => {
    let payloadLength = 0;
    for (const run of runs) {
      payloadLength += sourceRunPayloadLength(run);
      if (payloadLength > MAX_SOURCE_STREAM_TEXT_LENGTH) {
        context.addIssue({
          code: 'custom',
          message: `Source run payload exceeds ${MAX_SOURCE_STREAM_TEXT_LENGTH} characters`
        });
        return;
      }
    }
  });

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
