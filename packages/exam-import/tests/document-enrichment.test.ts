import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { readDocumentEnrichment } from '../src/docx/document-enrichment';
import { DOCX_PART, openDocxPackage } from '../src/docx/docx-package';

const RELATIONSHIP_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const IMAGE_RELATIONSHIP = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

function documentXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:m="${MATH_NS}"><w:body>${body}<w:sectPr/></w:body></w:document>`;
}

function relationsXml(relationships: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${RELATIONSHIP_NS}">${relationships}</Relationships>`;
}

function imageDrawing(relationshipId: string, container: 'inline' | 'anchor' = 'inline'): string {
  return `<w:r><w:drawing><wp:${container}><wp:extent wp:cx="9525" wp:cy="19050"/><a:graphic><a:graphicData><a:blip r:embed="${relationshipId}"/></a:graphicData></a:graphic></wp:${container}></w:drawing></w:r>`;
}

async function packageWith(input: { document: string; relationships?: string; media?: Record<string, Uint8Array> }) {
  const zip = new JSZip();
  zip.file(DOCX_PART.document, input.document);
  if (input.relationships) zip.file(DOCX_PART.documentRelations, input.relationships);
  for (const [path, bytes] of Object.entries(input.media ?? {})) zip.file(path, bytes);

  const bytes = await zip.generateAsync({ type: 'uint8array' });

  return openDocxPackage(bytes);
}

describe('embedded images', () => {
  it('extracts bytes, MIME type, dimensions and inline position', async () => {
    const pkg = await packageWith({
      document: documentXml(
        `<w:p><w:r><w:t>Before</w:t></w:r>${imageDrawing('rIdImage')}<w:r><w:t>After</w:t></w:r></w:p>`
      ),
      relationships: relationsXml(
        `<Relationship Id="rIdImage" Type="${IMAGE_RELATIONSHIP}" Target="media/pixel.png"/>`
      ),
      media: { 'word/media/pixel.png': new Uint8Array([1, 2, 3]) }
    });

    const enrichment = await readDocumentEnrichment(
      (await pkg.readText(DOCX_PART.document))!,
      await pkg.readText(DOCX_PART.documentRelations),
      pkg
    );

    expect(enrichment.imagesByBlock.get(0)).toEqual([
      {
        assetRef: 'docx:word/media/pixel.png',
        afterTextCharacters: 6,
        width: 1,
        height: 2,
        floating: false
      }
    ]);
    expect(enrichment.assets).toHaveLength(1);
    expect(enrichment.assets[0]).toMatchObject({
      ref: 'docx:word/media/pixel.png',
      packagePath: 'word/media/pixel.png',
      mimeType: 'image/png'
    });
    expect([...enrichment.assets[0]!.bytes]).toEqual([1, 2, 3]);
  });

  it('deduplicates asset bytes while retaining every anchor', async () => {
    const pkg = await packageWith({
      document: documentXml(`<w:p>${imageDrawing('rIdImage')}${imageDrawing('rIdImage', 'anchor')}</w:p>`),
      relationships: relationsXml(
        `<Relationship Id="rIdImage" Type="${IMAGE_RELATIONSHIP}" Target="media/pixel.png"/>`
      ),
      media: { 'word/media/pixel.png': new Uint8Array([7]) }
    });

    const enrichment = await readDocumentEnrichment(
      (await pkg.readText(DOCX_PART.document))!,
      await pkg.readText(DOCX_PART.documentRelations),
      pkg
    );

    expect(enrichment.imagesByBlock.get(0)).toHaveLength(2);
    expect(enrichment.imagesByBlock.get(0)?.map((image) => image.floating)).toEqual([false, true]);
    expect(enrichment.assets).toHaveLength(1);
  });

  it('does not fetch externally linked images', async () => {
    const pkg = await packageWith({
      document: documentXml(`<w:p>${imageDrawing('rIdExternal')}</w:p>`),
      relationships: relationsXml(
        `<Relationship Id="rIdExternal" Type="${IMAGE_RELATIONSHIP}" Target="https://example.com/image.png" TargetMode="External"/>`
      )
    });

    const enrichment = await readDocumentEnrichment(
      (await pkg.readText(DOCX_PART.document))!,
      await pkg.readText(DOCX_PART.documentRelations),
      pkg
    );

    expect(enrichment.imagesByBlock.size).toBe(0);
    expect(enrichment.assets).toEqual([]);
    expect(enrichment.externalImageRelationships).toEqual(['rIdExternal']);
  });

  it('extracts images anchored inside table cells', async () => {
    const pkg = await packageWith({
      document: documentXml(
        `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Before</w:t></w:r>${imageDrawing('rIdImage')}<w:r><w:t>After</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`
      ),
      relationships: relationsXml(
        `<Relationship Id="rIdImage" Type="${IMAGE_RELATIONSHIP}" Target="media/table.png"/>`
      ),
      media: { 'word/media/table.png': new Uint8Array([4, 5, 6]) }
    });

    const enrichment = await readDocumentEnrichment(
      (await pkg.readText(DOCX_PART.document))!,
      await pkg.readText(DOCX_PART.documentRelations),
      pkg
    );
    const table = enrichment.tablesByBlock.get(0);

    expect(table?.imagesByCell.get('0:0')).toEqual([
      {
        assetRef: 'docx:word/media/table.png',
        afterTextCharacters: 6,
        width: 1,
        height: 2,
        floating: false
      }
    ]);
    expect(enrichment.assets.map((asset) => asset.ref)).toEqual(['docx:word/media/table.png']);
  });

  it('removes anchors whose relationship target has no package bytes and reports the loss', async () => {
    const pkg = await packageWith({
      document: documentXml(`<w:p>${imageDrawing('rIdMissing')}</w:p>`),
      relationships: relationsXml(
        `<Relationship Id="rIdMissing" Type="${IMAGE_RELATIONSHIP}" Target="media/missing.png"/>`
      )
    });

    const enrichment = await readDocumentEnrichment(
      (await pkg.readText(DOCX_PART.document))!,
      await pkg.readText(DOCX_PART.documentRelations),
      pkg
    );

    expect(enrichment.imagesByBlock.size).toBe(0);
    expect(enrichment.assets).toEqual([]);
    expect(enrichment.missingImageAssets).toEqual(['docx:word/media/missing.png']);
  });

  it.each([
    { relationships: undefined, expected: 'rIdUnknown' },
    {
      relationships: relationsXml(
        `<Relationship Id="rIdUnknown" Type="${IMAGE_RELATIONSHIP}" Target="../../outside.png"/>`
      ),
      expected: 'rIdUnknown'
    },
    {
      relationships: relationsXml(
        `<Relationship Id="rIdUnknown" Type="${IMAGE_RELATIONSHIP}" Target="https://example.com/image.png"/>`
      ),
      expected: 'rIdUnknown'
    }
  ])(
    'reports an image relationship that cannot resolve to a safe package part',
    async ({ relationships, expected }) => {
      const pkg = await packageWith({
        document: documentXml(`<w:p>${imageDrawing('rIdUnknown')}</w:p>`),
        relationships
      });

      const enrichment = await readDocumentEnrichment(
        (await pkg.readText(DOCX_PART.document))!,
        await pkg.readText(DOCX_PART.documentRelations),
        pkg
      );

      expect(enrichment.imagesByBlock.size).toBe(0);
      expect(enrichment.unresolvedImageRelationships).toEqual([expected]);
    }
  );
});

describe('table structure', () => {
  it('keeps grid coordinates and merged-cell origins', async () => {
    const pkg = await packageWith({
      document: documentXml(
        `<w:tbl>` +
          `<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Header</w:t></w:r></w:p></w:tc></w:tr>` +
          `<w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>Shared</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr>` +
          `<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:p><w:r><w:t>C</w:t></w:r></w:p></w:tc></w:tr>` +
          `</w:tbl>`
      )
    });

    const enrichment = await readDocumentEnrichment(
      (await pkg.readText(DOCX_PART.document))!,
      await pkg.readText(DOCX_PART.documentRelations),
      pkg
    );
    const table = enrichment.tablesByBlock.get(0);

    expect(table?.tableIndex).toBe(0);
    expect(table?.rows).toEqual([
      [{ physicalColumn: 0, column: 0, originRow: 0, originColumn: 0 }],
      [
        { physicalColumn: 0, column: 0, originRow: 1, originColumn: 0 },
        { physicalColumn: 1, column: 1, originRow: 1, originColumn: 1 }
      ],
      [
        { physicalColumn: 0, column: 0, originRow: 1, originColumn: 0 },
        { physicalColumn: 1, column: 1, originRow: 2, originColumn: 1 }
      ]
    ]);
  });

  it('honours gridBefore and legacy horizontal merge origins', async () => {
    const pkg = await packageWith({
      document: documentXml(
        '<w:tbl><w:tr><w:trPr><w:gridBefore w:val="2"/></w:trPr>' +
          '<w:tc><w:tcPr><w:hMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>' +
          '<w:tc><w:tcPr><w:hMerge/></w:tcPr><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc>' +
          '</w:tr></w:tbl>'
      )
    });

    const enrichment = await readDocumentEnrichment(
      (await pkg.readText(DOCX_PART.document))!,
      await pkg.readText(DOCX_PART.documentRelations),
      pkg
    );

    expect(enrichment.tablesByBlock.get(0)?.rows).toEqual([
      [
        { physicalColumn: 0, column: 2, originRow: 0, originColumn: 2 },
        { physicalColumn: 1, column: 3, originRow: 0, originColumn: 2 }
      ]
    ]);
  });

  it('does not promote rows from a nested table into the parent table', async () => {
    const pkg = await packageWith({
      document: documentXml(
        '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Outer</w:t></w:r></w:p>' +
          '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Inner</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
          '</w:tc></w:tr></w:tbl>'
      )
    });

    const enrichment = await readDocumentEnrichment(
      (await pkg.readText(DOCX_PART.document))!,
      await pkg.readText(DOCX_PART.documentRelations),
      pkg
    );
    const table = enrichment.tablesByBlock.get(0);

    expect(table?.rows).toHaveLength(1);
    expect(table?.rows[0]).toHaveLength(1);
    expect(table?.nestedTableCount).toBe(1);
  });
});

describe('Office Math anchors', () => {
  it('records converted math at the text position it occupies, consuming no characters', async () => {
    const pkg = await packageWith({
      document: documentXml(
        '<w:p><w:r><w:t>Before</w:t></w:r>' +
          '<m:oMath><m:f><m:num><m:r><m:t>1</m:t></m:r></m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f></m:oMath>' +
          '<w:r><w:t>After</w:t></w:r></w:p>'
      )
    });

    const enrichment = await readDocumentEnrichment(
      (await pkg.readText(DOCX_PART.document))!,
      await pkg.readText(DOCX_PART.documentRelations),
      pkg
    );

    expect(enrichment.mathByBlock.get(0)).toEqual([
      {
        afterTextCharacters: 6,
        textCharacters: 0,
        latex: String.raw`\frac{1}{2}`,
        omml: null,
        sourceText: '12',
        reason: null
      }
    ]);
  });

  it('keeps an unsupported formula reviewable inside a table cell', async () => {
    const pkg = await packageWith({
      document: documentXml(
        '<w:tbl><w:tr><w:tc><w:p><m:oMath><m:unknown><m:r><m:t>x</m:t></m:r></m:unknown></m:oMath></w:p></w:tc></w:tr></w:tbl>'
      )
    });

    const enrichment = await readDocumentEnrichment(
      (await pkg.readText(DOCX_PART.document))!,
      await pkg.readText(DOCX_PART.documentRelations),
      pkg
    );
    const table = enrichment.tablesByBlock.get(0);

    expect(table?.mathByCell.get('0:0')).toEqual([
      {
        afterTextCharacters: 0,
        textCharacters: 0,
        latex: null,
        omml: expect.stringContaining('<m:unknown>'),
        sourceText: 'x',
        reason: 'Unsupported Office Math element: m:unknown'
      }
    ]);
    expect(table?.mathByCell.get('0:0')?.[0]?.omml).toContain('xmlns:m=');
    expect(table?.mathByCell.get('0:0')?.[0]?.omml).toContain('xmlns:w=');
  });
});
