import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { readDocumentEnrichment } from '../src/docx/document-enrichment';
import { DOCX_PART, openDocxPackage } from '../src/docx/docx-package';

const RELATIONSHIP_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const IMAGE_RELATIONSHIP = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

function documentXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`;
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
  });
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
});
