import { describe, expect, it } from 'vitest';
import { emptyFormatting, normalizeComparableText, sourceRunSchema } from '../src/source-run';

function validRun() {
  return {
    text: 'Câu 1.',
    formatting: emptyFormatting(),
    block: { kind: 'paragraph' as const, index: 0, listNumber: null, tableRef: null },
    math: null,
    image: null,
    location: { blockIndex: 0, runIndex: 0 }
  };
}

describe('source run contract', () => {
  it('accepts a fully specified run', () => {
    expect(sourceRunSchema.safeParse(validRun()).success).toBe(true);
  });

  it('rejects a run that omits a formatting mark instead of stating it', () => {
    const run = validRun();
    delete (run.formatting as Partial<typeof run.formatting>).underline;

    expect(sourceRunSchema.safeParse(run).success).toBe(false);
  });

  it('rejects a run that omits an unknown value instead of stating null', () => {
    const run = validRun();
    delete (run as Partial<ReturnType<typeof validRun>>).math;

    expect(sourceRunSchema.safeParse(run).success).toBe(false);
  });

  it('rejects unknown keys so readers cannot smuggle format-specific fields through', () => {
    expect(sourceRunSchema.safeParse({ ...validRun(), officeparserNode: {} }).success).toBe(false);
  });

  it('rejects a colour that is not resolved to a hex triplet', () => {
    const run = validRun();
    run.formatting.color = 'accent1';

    expect(sourceRunSchema.safeParse(run).success).toBe(false);
  });

  it('accepts a resolved list label and a table reference', () => {
    const run = validRun();
    run.block = { kind: 'list_item', index: 4, listNumber: 'A.', tableRef: null };
    expect(sourceRunSchema.safeParse(run).success).toBe(true);

    const cell = validRun();
    cell.block = {
      kind: 'table_cell',
      index: 9,
      listNumber: null,
      tableRef: { tableIndex: 0, row: 1, column: 2, originRow: 1, originColumn: 2 }
    };
    expect(sourceRunSchema.safeParse(cell).success).toBe(true);
  });

  it('accepts a reviewable OMML fallback without pretending it is LaTeX', () => {
    const run = {
      ...validRun(),
      text: '',
      math: {
        latex: null,
        omml: '<m:oMath><m:unknown/></m:oMath>',
        sourceText: 'x',
        reason: 'Unsupported Office Math element: m:unknown'
      }
    };

    expect(sourceRunSchema.safeParse(run).success).toBe(true);
  });
});

describe('comparable text normalization', () => {
  it('collapses whitespace and case', () => {
    expect(normalizeComparableText('  Paragraph   2 ')).toBe('paragraph 2');
  });

  it('treats decomposed and precomposed Vietnamese as equal', () => {
    const precomposed = 'Đề thi';
    const decomposed = 'Đề thi'.normalize('NFD');

    expect(decomposed).not.toBe(precomposed);
    expect(normalizeComparableText(decomposed)).toBe(normalizeComparableText(precomposed));
  });
});
