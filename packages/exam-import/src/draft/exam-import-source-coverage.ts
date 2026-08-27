import type { ExamImportDraft, ExamImportSourceSpan } from './exam-import-draft';
import type { ExamImportSourceBlock } from './exam-import-segmentation';

/**
 * Which blocks of the source the draft actually accounts for.
 *
 * Every node carries provenance already, so completeness is a question that can simply be
 * asked: union every span, and diff it against the blocks the reader produced. A block in
 * neither is content that left the document without anybody being told — the quiet failure
 * that a question count alone cannot detect, because a paper missing its last section
 * still reports a perfectly plausible number of questions.
 *
 * This measures; it does not judge. A block may be legitimately unattributed — a page
 * header, a footer, a name line — so the caller decides what an unattributed block means.
 */
export type ExamImportSourceCoverage = {
  total: number;
  attributed: number;
  /** Block indexes no span in the draft covers, in document order. */
  unattributed: number[];
};

function collectSpans(value: unknown, into: ExamImportSourceSpan[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectSpans(item, into);
    return;
  }
  if (typeof value !== 'object' || value === null) return;

  const candidate = value as { start?: { blockIndex?: unknown }; end?: { blockIndex?: unknown } };
  if (typeof candidate.start?.blockIndex === 'number' && typeof candidate.end?.blockIndex === 'number') {
    into.push(value as ExamImportSourceSpan);
    return;
  }

  for (const nested of Object.values(value)) collectSpans(nested, into);
}

export function examImportSourceCoverage(
  draft: ExamImportDraft,
  blocks: readonly ExamImportSourceBlock[]
): ExamImportSourceCoverage {
  const spans: ExamImportSourceSpan[] = [];
  collectSpans(draft, spans);

  const covered = new Set<number>();
  for (const span of spans) {
    for (let index = span.start.blockIndex; index <= span.end.blockIndex; index += 1) covered.add(index);
  }

  const unattributed = blocks
    .filter((block) => block.text.trim().length > 0 && !covered.has(block.index))
    .map((block) => block.index)
    .sort((left, right) => left - right);

  return {
    total: blocks.length,
    attributed: blocks.length - unattributed.length,
    unattributed
  };
}
