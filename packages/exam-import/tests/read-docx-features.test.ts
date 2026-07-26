import { Socket } from 'node:net';
import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { DOCX_PART } from '../src/docx/docx-package';
import { readDocxRuns } from '../src/docx/read-docx-runs';

const DOCUMENT_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const RELATIONSHIP_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const IMAGE_RELATIONSHIP = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

function documentXml(body: string): string {
  return `<w:document xmlns:w="${DOCUMENT_NS}" xmlns:m="${MATH_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="${DRAWING_NS}"><w:body>${body}<w:sectPr/></w:body></w:document>`;
}

function imageDrawing(relationshipId: string): string {
  return `<w:r><w:drawing><wp:inline><wp:extent wp:cx="9525" wp:cy="19050"/><a:graphic><a:graphicData><a:blip r:embed="${relationshipId}"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

async function docxWith(input: {
  body: string;
  styles?: string;
  theme?: string;
  relationships?: string;
  media?: Record<string, Uint8Array>;
  utf16Document?: boolean;
}): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>'
  );
  zip.file(
    '_rels/.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>'
  );
  const sourceDocument = documentXml(input.body);
  const documentPart = input.utf16Document
    ? new Uint8Array([0xff, 0xfe, ...Buffer.from(sourceDocument, 'utf16le')])
    : sourceDocument;
  zip.file(DOCX_PART.document, documentPart);
  if (input.styles) zip.file(DOCX_PART.styles, input.styles);
  if (input.theme) zip.file(DOCX_PART.theme, input.theme);
  if (input.relationships) {
    zip.file(
      DOCX_PART.documentRelations,
      `<Relationships xmlns="${RELATIONSHIP_NS}">${input.relationships}</Relationships>`
    );
  }
  for (const [path, bytes] of Object.entries(input.media ?? {})) zip.file(path, bytes);

  return zip.generateAsync({ type: 'uint8array' });
}

describe('formatting-aware DOCX reader', () => {
  it('emits effective inherited formatting instead of officeparser flat style output', async () => {
    const styles = `<w:styles xmlns:w="${DOCUMENT_NS}">
      <w:docDefaults><w:rPrDefault><w:rPr><w:strike/></w:rPr></w:rPrDefault></w:docDefaults>
      <w:style w:type="paragraph" w:styleId="Base"><w:rPr><w:b/></w:rPr></w:style>
      <w:style w:type="paragraph" w:styleId="Child"><w:basedOn w:val="Base"/><w:rPr><w:i/></w:rPr></w:style>
      <w:style w:type="character" w:styleId="Answer"><w:rPr>
        <w:u/><w:color w:themeColor="accent1"/><w:highlight w:val="yellow"/>
      </w:rPr></w:style>
    </w:styles>`;
    const theme = `<a:theme xmlns:a="${DRAWING_NS}"><a:themeElements><a:clrScheme name="Exam">
      <a:accent1><a:srgbClr val="4472C4"/></a:accent1>
    </a:clrScheme></a:themeElements></a:theme>`;
    const bytes = await docxWith({
      body:
        '<w:p><w:pPr><w:pStyle w:val="Child"/></w:pPr><w:r><w:rPr>' +
        '<w:rStyle w:val="Answer"/><w:b w:val="0"/></w:rPr><w:t>Answer</w:t></w:r></w:p>',
      styles,
      theme
    });

    const result = await readDocxRuns(bytes);
    const answer = result.runs.find((run) => run.text === 'Answer');

    expect(answer?.formatting).toEqual({
      bold: false,
      italic: true,
      underline: true,
      strikethrough: true,
      color: '#4472C4',
      highlight: '#FFFF00'
    });
    expect(result.warnings).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'FORMATTING_ALIGNMENT_FAILED' })])
    );
  });

  it('replaces flattened Office Math text with one LaTeX source run', async () => {
    const bytes = await docxWith({
      body:
        '<w:p><w:r><w:t>Before </w:t></w:r>' +
        '<m:oMath><m:f><m:num><m:r><m:t>1</m:t></m:r></m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f></m:oMath>' +
        '<w:r><w:t> after</w:t></w:r></w:p>'
    });

    const result = await readDocxRuns(bytes);

    expect(result.runs.map((run) => run.text).join('')).toBe('Before  after');
    expect(result.runs.filter((run) => run.math !== null)).toEqual([
      expect.objectContaining({ math: { latex: String.raw`\frac{1}{2}` } })
    ]);
  });

  it('preserves unsupported Office Math as a reviewable OMML run instead of flattened text', async () => {
    const bytes = await docxWith({
      body: '<w:p><m:oMath><m:unknown><m:r><m:t>x</m:t></m:r></m:unknown></m:oMath></w:p>'
    });

    const result = await readDocxRuns(bytes);

    expect(result.runs.map((run) => run.text).join('')).toBe('');
    expect(result.runs.map((run) => run.math).filter((math) => math !== null)).toEqual([
      {
        latex: null,
        omml: expect.stringContaining('<m:unknown>'),
        sourceText: 'x',
        reason: 'Unsupported Office Math element: m:unknown'
      }
    ]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'UNSUPPORTED_OFFICE_MATH',
        blockIndex: 0
      })
    ]);
  });

  it('converts Office Math inside a table cell', async () => {
    const bytes = await docxWith({
      body:
        '<w:tbl><w:tr><w:tc><w:p><m:oMath>' +
        '<m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup>' +
        '</m:oMath></w:p></w:tc></w:tr></w:tbl>'
    });

    const result = await readDocxRuns(bytes);

    expect(result.runs).toEqual([
      expect.objectContaining({
        block: expect.objectContaining({
          kind: 'table_cell',
          tableRef: expect.objectContaining({ row: 0, column: 0 })
        }),
        math: { latex: 'x^{2}' }
      })
    ]);
  });

  it('emits merged continuation cells with the origin coordinates', async () => {
    const bytes = await docxWith({
      body:
        '<w:tbl>' +
        '<w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>Shared</w:t></w:r></w:p></w:tc></w:tr>' +
        '<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr>' +
        '</w:tbl>'
    });

    const result = await readDocxRuns(bytes);
    const cells = result.runs.map((run) => ({ text: run.text, tableRef: run.block.tableRef }));

    expect(cells).toEqual([
      {
        text: 'Shared',
        tableRef: { tableIndex: 0, row: 0, column: 0, originRow: 0, originColumn: 0 }
      },
      {
        text: '',
        tableRef: { tableIndex: 0, row: 1, column: 0, originRow: 0, originColumn: 0 }
      }
    ]);
  });

  it('interleaves an image inside a table cell and returns its bytes', async () => {
    const bytes = await docxWith({
      body:
        '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Before</w:t></w:r>' +
        imageDrawing('rIdImage') +
        '<w:r><w:t>After</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
      relationships: `<Relationship Id="rIdImage" Type="${IMAGE_RELATIONSHIP}" Target="media/table.png"/>`,
      media: { 'word/media/table.png': new Uint8Array([1, 2, 3]) }
    });

    const result = await readDocxRuns(bytes);
    const cellRuns = result.runs.filter((run) => run.block.tableRef?.row === 0);

    expect(cellRuns.map((run) => run.text).join('')).toBe('BeforeAfter');
    expect(cellRuns.find((run) => run.image !== null)).toMatchObject({
      image: {
        assetRef: 'docx:word/media/table.png',
        width: 1,
        height: 2,
        placement: 'inline'
      }
    });
    expect(result.assets.map((asset) => asset.ref)).toEqual(['docx:word/media/table.png']);
  });

  it('does not emit a dangling image run when relationship bytes are missing', async () => {
    const bytes = await docxWith({
      body: `<w:p>${imageDrawing('rIdMissing')}</w:p>`,
      relationships: `<Relationship Id="rIdMissing" Type="${IMAGE_RELATIONSHIP}" Target="media/missing.png"/>`
    });

    const result = await readDocxRuns(bytes);

    expect(result.runs.every((run) => run.image === null)).toBe(true);
    expect(result.assets).toEqual([]);
    expect(result.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'MISSING_IMAGE_ASSET' })]));
  });

  it('warns when an image reference has no resolvable relationship', async () => {
    const bytes = await docxWith({
      body: `<w:p>${imageDrawing('rIdUnknown')}</w:p>`
    });

    const result = await readDocxRuns(bytes);

    expect(result.runs.every((run) => run.image === null)).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'UNRESOLVED_IMAGE_RELATIONSHIP' })])
    );
  });

  it('keeps parent table coordinates and warns when nested structure is flattened', async () => {
    const bytes = await docxWith({
      body:
        '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Outer</w:t></w:r></w:p>' +
        '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Inner</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
        '</w:tc></w:tr></w:tbl>'
    });

    const result = await readDocxRuns(bytes);

    expect(result.runs.map((run) => run.text).join('')).toBe('OuterInner');
    expect(new Set(result.runs.map((run) => JSON.stringify(run.block.tableRef)))).toEqual(
      new Set([JSON.stringify({ tableIndex: 0, row: 0, column: 0, originRow: 0, originColumn: 0 })])
    );
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'NESTED_TABLE_STRUCTURE_FLATTENED' })])
    );
  });

  it('maps gridBefore and legacy horizontal merge cells by physical position', async () => {
    const bytes = await docxWith({
      body:
        '<w:tbl><w:tr><w:trPr><w:gridBefore w:val="2"/></w:trPr>' +
        '<w:tc><w:tcPr><w:hMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>' +
        '<w:tc><w:tcPr><w:hMerge/></w:tcPr><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc>' +
        '</w:tr></w:tbl>'
    });

    const result = await readDocxRuns(bytes);

    expect(result.runs.map((run) => ({ text: run.text, tableRef: run.block.tableRef }))).toEqual([
      {
        text: 'A',
        tableRef: { tableIndex: 0, row: 0, column: 2, originRow: 0, originColumn: 2 }
      },
      {
        text: 'B',
        tableRef: { tableIndex: 0, row: 0, column: 3, originRow: 0, originColumn: 2 }
      }
    ]);
  });

  it('rejects unsafe XML before officeparser sees the package', async () => {
    const bytes = await docxWith({
      body: '<!ENTITY secret SYSTEM "file:///etc/passwd"><w:p><w:r><w:t>&secret;</w:t></w:r></w:p>'
    });

    await expect(readDocxRuns(bytes)).rejects.toMatchObject({ code: 'UNSAFE_XML_DECLARATION' });
  });

  it('reads a UTF-16LE document part through the XML security preflight', async () => {
    const bytes = await docxWith({
      body: '<w:p><w:r><w:t>Đề thi</w:t></w:r></w:p>',
      utf16Document: true
    });

    const result = await readDocxRuns(bytes);

    expect(result.runs.map((run) => run.text).join('')).toBe('Đề thi');
  });

  it('reads deterministically without opening a network transport', async () => {
    const bytes = await docxWith({
      body: `<w:p><w:r><w:t>Offline exam</w:t></w:r>${imageDrawing('rIdExternal')}</w:p>`,
      relationships: `<Relationship Id="rIdExternal" Type="${IMAGE_RELATIONSHIP}" Target="https://example.com/image.png" TargetMode="External"/>`
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network disabled'));
    const connectSpy = vi.spyOn(Socket.prototype, 'connect').mockImplementation(() => {
      throw new Error('network disabled');
    });

    try {
      const result = await readDocxRuns(bytes);

      expect(result.runs.map((run) => run.text).join('')).toBe('Offline exam');
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'EXTERNAL_IMAGE_NOT_EMBEDDED' })])
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(connectSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      connectSpy.mockRestore();
    }
  });
});
