import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { readDocxRuns, type DocxReadResult } from '../src/docx/read-docx-runs';
import { sourceRunSchema } from '../src/source-run';

const CORPUS_DOCX = join(__dirname, '..', '..', '..', 'fixtures', 'exams', '2026-en-on-luyen-03-scan-converted.docx');

function corpusBytes(): Uint8Array {
  return new Uint8Array(readFileSync(CORPUS_DOCX));
}

describe('reading the reference exam', () => {
  let result: DocxReadResult;

  beforeAll(async () => {
    result = await readDocxRuns(corpusBytes());
  });

  it('recovers text from the document', () => {
    expect(result.runs.length).toBeGreaterThan(100);
  });

  // The contract is only worth having if real input satisfies it. A reader that
  // omits a field rather than stating null would pass every other test here.
  it('every run satisfies the source run contract', () => {
    for (const run of result.runs) {
      const parsed = sourceRunSchema.safeParse(run);
      if (!parsed.success) {
        throw new Error(`run at block ${run.block.index} violates the contract: ${parsed.error.message}`);
      }
    }
  });

  it('numbers blocks consecutively from zero', () => {
    const indexes = [...new Set(result.runs.map((run) => run.block.index))];

    expect(indexes[0]).toBe(0);
    expect(indexes).toEqual(indexes.map((_, position) => position));
  });

  it('keeps each run addressable back to its source', () => {
    for (const run of result.runs) {
      expect(run.location.blockIndex).toBe(run.block.index);
      expect(run.location.runIndex).toBeGreaterThanOrEqual(0);
    }
  });

  // FR-6 on real input: these letters exist nowhere in the text layer.
  it('labels the auto-numbered options of question 6', () => {
    // officeparser splits a paragraph into one run per word, so a block's text
    // has to be reassembled before it can be matched.
    const blocks = new Map<number, { text: string; kind: string; listNumber: string | null }>();
    for (const run of result.runs) {
      const existing = blocks.get(run.block.index);
      if (existing) {
        existing.text += run.text;
        continue;
      }

      blocks.set(run.block.index, {
        text: run.text,
        kind: run.block.kind,
        listNumber: run.block.listNumber
      });
    }

    const option = [...blocks.values()].find((block) => block.text.includes('child who copies another'));

    expect(option?.kind).toBe('list_item');
    expect(option?.listNumber).toBe('A.');
  });

  it('labels the four options of that question A through D', () => {
    const optionBlocks = result.runs.filter(
      (run) => run.block.kind === 'list_item' && run.block.index >= 0 && run.block.listNumber !== null
    );
    const labels = [...new Set(optionBlocks.map((run) => run.block.listNumber))];

    expect(labels).toEqual(expect.arrayContaining(['A.', 'B.', 'C.', 'D.']));
  });

  it('labels an arrangement list that starts at b, not at a', () => {
    const labels = result.runs
      .filter((run) => run.block.kind === 'list_item')
      .map((run) => run.block.listNumber)
      .filter((label): label is string => label !== null);

    expect(labels).toContain('b.');
    expect(labels).toContain('e.');
  });

  it('recovers the underline that marks a vocabulary target', () => {
    const underlined = result.runs.filter((run) => run.formatting.underline);

    expect(underlined.length).toBeGreaterThan(0);
    expect(underlined.some((run) => run.text.includes('impeccable'))).toBe(true);
  });

  it('resolves colours to hex triplets or to null, never to a theme name', () => {
    for (const run of result.runs) {
      if (run.formatting.color === null) continue;

      expect(run.formatting.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('states that highlight was not inspected rather than claiming it is absent', () => {
    expect(result.runs.every((run) => run.formatting.highlight === null)).toBe(true);
  });

  it('extracts embedded images and keeps every run backed by asset bytes', () => {
    const imageRuns = result.runs.filter((run) => run.image !== null);
    const assetsByRef = new Map(result.assets.map((asset) => [asset.ref, asset]));

    expect(imageRuns.length).toBeGreaterThan(0);
    expect(result.assets.length).toBeGreaterThan(0);
    for (const run of imageRuns) {
      const asset = assetsByRef.get(run.image!.assetRef);
      expect(asset, `missing bytes for ${run.image!.assetRef}`).toBeDefined();
      expect(asset!.bytes.byteLength).toBeGreaterThan(0);
      expect(asset!.mimeType).toMatch(/^image\//);
    }
  });

  it('marks floating image placement as approximate instead of pretending it is inline', () => {
    const floatingImages = result.runs.filter((run) => run.image?.placement === 'floating');

    expect(floatingImages.length).toBeGreaterThan(0);
    expect(result.warnings.some((entry) => entry.code === 'FLOATING_IMAGE_POSITION_APPROXIMATE')).toBe(true);
  });

  it('leaves no list label unresolved', () => {
    expect(result.warnings.filter((entry) => entry.code === 'UNRESOLVED_LIST_LABEL')).toEqual([]);
  });
});

describe('reproducibility', () => {
  it('produces an identical stream for identical bytes', async () => {
    const [first, second] = await Promise.all([readDocxRuns(corpusBytes()), readDocxRuns(corpusBytes())]);

    expect(JSON.stringify(second.runs)).toBe(JSON.stringify(first.runs));
    expect(second.warnings).toEqual(first.warnings);
  });
});
