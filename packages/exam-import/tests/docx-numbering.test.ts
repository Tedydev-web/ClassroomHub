import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { DOCX_PART, DocxPackageError, openDocxPackage } from '../src/docx/docx-package';
import { findListLevel, parseNumberingDefinitions } from '../src/docx/numbering-definitions';
import { renderListLabel } from '../src/docx/list-label';

const CORPUS_DOCX = join(__dirname, '..', '..', '..', 'fixtures', 'exams', '2026-en-on-luyen-03-scan-converted.docx');

function numberingXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${body}</w:numbering>`;
}

async function zipWith(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);

  return zip.generateAsync({ type: 'uint8array' });
}

describe('numbering definitions', () => {
  it('reads format, template and start for a level', () => {
    const definitions = parseNumberingDefinitions(
      numberingXml(
        `<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperLetter"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>` +
          `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`
      )
    );

    expect(findListLevel(definitions, '1')).toEqual({ format: 'upperLetter', text: '%1.', start: 1 });
  });

  it('resolves the numId to abstractNumId indirection', () => {
    const definitions = parseNumberingDefinitions(
      numberingXml(
        `<w:abstractNum w:abstractNumId="7"><w:lvl w:ilvl="0"><w:start w:val="3"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1)"/></w:lvl></w:abstractNum>` +
          `<w:num w:numId="42"><w:abstractNumId w:val="7"/></w:num>`
      )
    );

    expect(findListLevel(definitions, '42')?.start).toBe(3);
    expect(findListLevel(definitions, '7')).toBeNull();
  });

  it('applies a start override, which silently mislabels a whole list when ignored', () => {
    const definitions = parseNumberingDefinitions(
      numberingXml(
        `<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>` +
          `<w:num w:numId="1"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="2"/></w:lvlOverride></w:num>`
      )
    );

    const level = findListLevel(definitions, '1');
    expect(level?.start).toBe(2);
    expect(renderListLabel(level!, 0)).toBe('b.');
  });

  it('applies a full level override', () => {
    const definitions = parseNumberingDefinitions(
      numberingXml(
        `<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>` +
          `<w:num w:numId="1"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1)"/></w:lvl></w:lvlOverride></w:num>`
      )
    );

    expect(findListLevel(definitions, '1')).toEqual({ format: 'upperRoman', text: '%1)', start: 1 });
  });

  it('keeps several levels of the same list apart', () => {
    const definitions = parseNumberingDefinitions(
      numberingXml(
        `<w:abstractNum w:abstractNumId="0">` +
          `<w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>` +
          `<w:lvl w:ilvl="1"><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2."/></w:lvl>` +
          `</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`
      )
    );

    expect(findListLevel(definitions, '1', 0)?.format).toBe('decimal');
    expect(findListLevel(definitions, '1', 1)?.format).toBe('lowerLetter');
    expect(findListLevel(definitions, '1', 2)).toBeNull();
  });

  it('degrades a format it cannot render to none instead of guessing', () => {
    const definitions = parseNumberingDefinitions(
      numberingXml(
        `<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="ideographDigital"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>` +
          `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`
      )
    );

    expect(findListLevel(definitions, '1')?.format).toBe('none');
    expect(renderListLabel(findListLevel(definitions, '1')!, 0)).toBeNull();
  });

  it('returns nothing for a document with no numbering part', () => {
    expect(parseNumberingDefinitions('<w:document/>').size).toBe(0);
  });
});

describe('docx package safety', () => {
  it('refuses a file that is not a zip', async () => {
    await expect(openDocxPackage(new TextEncoder().encode('plain text'))).rejects.toMatchObject({
      code: 'NOT_A_ZIP'
    });
  });

  it('refuses a package with no document part', async () => {
    const data = await zipWith({ 'word/styles.xml': '<w:styles/>' });

    await expect(openDocxPackage(data)).rejects.toMatchObject({ code: 'MISSING_DOCUMENT' });
  });

  it('refuses an entry that escapes its directory', async () => {
    const data = await zipWith({ [DOCX_PART.document]: '<w:document/>', '../escape.xml': 'x' });

    await expect(openDocxPackage(data)).rejects.toMatchObject({ code: 'UNSAFE_ENTRY_NAME' });
  });

  it('refuses an absolute entry name', async () => {
    const data = await zipWith({ [DOCX_PART.document]: '<w:document/>', '/etc/passwd': 'x' });

    await expect(openDocxPackage(data)).rejects.toMatchObject({ code: 'UNSAFE_ENTRY_NAME' });
  });

  it('refuses a package with more entries than the limit allows', async () => {
    const data = await zipWith({ [DOCX_PART.document]: '<w:document/>', 'a.xml': 'a', 'b.xml': 'b' });

    await expect(
      openDocxPackage(data, { maxEntries: 2, maxTotalUncompressedBytes: 1024, maxPartBytes: 1024 })
    ).rejects.toMatchObject({ code: 'TOO_MANY_ENTRIES' });
  });

  it('refuses a package that declares more expanded bytes than allowed', async () => {
    const data = await zipWith({ [DOCX_PART.document]: 'x'.repeat(4096) });

    await expect(
      openDocxPackage(data, { maxEntries: 10, maxTotalUncompressedBytes: 64, maxPartBytes: 4096 })
    ).rejects.toMatchObject({ code: 'PACKAGE_TOO_LARGE' });
  });

  it('reports a missing part as null rather than throwing', async () => {
    const data = await zipWith({ [DOCX_PART.document]: '<w:document/>' });
    const pkg = await openDocxPackage(data);

    expect(await pkg.readText(DOCX_PART.numbering)).toBeNull();
  });

  it('errors carry a code callers can branch on', async () => {
    await expect(openDocxPackage(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(DocxPackageError);
  });
});

describe('the reference exam, read from its real package', () => {
  async function openCorpus() {
    return openDocxPackage(new Uint8Array(readFileSync(CORPUS_DOCX)));
  }

  it('exposes the parts the reader depends on', async () => {
    const pkg = await openCorpus();
    const names = pkg.entryNames();

    expect(names).toContain(DOCX_PART.document);
    expect(names).toContain(DOCX_PART.numbering);
    expect(names).toContain(DOCX_PART.styles);
  });

  // The load-bearing case: the option letters of several questions exist only
  // as a list reference. Without this resolution the answer key has nothing to
  // attach to, so these two assertions are what FR-6 comes down to.
  it('renders the option letters that never appear in the text layer', async () => {
    const pkg = await openCorpus();
    const numbering = await pkg.readText(DOCX_PART.numbering);
    const definitions = parseNumberingDefinitions(numbering!);
    const options = findListLevel(definitions, '1');

    expect(options).toEqual({ format: 'upperLetter', text: '%1.', start: 1 });
    expect([0, 1, 2, 3].map((index) => renderListLabel(options!, index))).toEqual(['A.', 'B.', 'C.', 'D.']);
  });

  it('renders the arrangement items that start at b', async () => {
    const pkg = await openCorpus();
    const definitions = parseNumberingDefinitions((await pkg.readText(DOCX_PART.numbering))!);
    const level = findListLevel(definitions, '6');

    expect(level).toEqual({ format: 'lowerLetter', text: '%1.', start: 2 });
    expect([0, 1, 2, 3].map((index) => renderListLabel(level!, index))).toEqual(['b.', 'c.', 'd.', 'e.']);
  });

  it('defines every list the document references', async () => {
    const pkg = await openCorpus();
    const definitions = parseNumberingDefinitions((await pkg.readText(DOCX_PART.numbering))!);

    expect(definitions.size).toBe(9);
  });
});
