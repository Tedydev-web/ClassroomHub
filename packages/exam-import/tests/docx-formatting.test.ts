import { describe, expect, it } from 'vitest';
import { readDocumentFormatting } from '../src/docx/docx-formatting';

const DOCUMENT_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';

describe('effective DOCX formatting', () => {
  it('applies defaults, paragraph and character style chains, theme colours, then direct overrides', () => {
    const documentXml = `<w:document xmlns:w="${DOCUMENT_NS}"><w:body><w:p>
      <w:pPr><w:pStyle w:val="ChildParagraph"/></w:pPr>
      <w:r><w:rPr><w:rStyle w:val="Choice"/><w:b w:val="0"/></w:rPr><w:t>Answer</w:t></w:r>
    </w:p></w:body></w:document>`;
    const stylesXml = `<w:styles xmlns:w="${DOCUMENT_NS}">
      <w:docDefaults><w:rPrDefault><w:rPr><w:strike/></w:rPr></w:rPrDefault></w:docDefaults>
      <w:style w:type="paragraph" w:styleId="BaseParagraph"><w:rPr><w:b/></w:rPr></w:style>
      <w:style w:type="paragraph" w:styleId="ChildParagraph">
        <w:basedOn w:val="BaseParagraph"/><w:rPr><w:i/></w:rPr>
      </w:style>
      <w:style w:type="character" w:styleId="BaseCharacter"><w:rPr><w:u w:val="single"/></w:rPr></w:style>
      <w:style w:type="character" w:styleId="Choice">
        <w:basedOn w:val="BaseCharacter"/>
        <w:rPr><w:color w:themeColor="accent1"/><w:highlight w:val="yellow"/></w:rPr>
      </w:style>
    </w:styles>`;
    const themeXml = `<a:theme xmlns:a="${DRAWING_NS}"><a:themeElements><a:clrScheme name="Exam">
      <a:accent1><a:srgbClr val="4472C4"/></a:accent1>
    </a:clrScheme></a:themeElements></a:theme>`;

    const formatting = readDocumentFormatting(documentXml, stylesXml, themeXml);

    expect(formatting.paragraphsByBlock.get(0)).toEqual([
      {
        text: 'Answer',
        formatting: {
          bold: false,
          italic: true,
          underline: true,
          strikethrough: true,
          color: '#4472C4',
          highlight: '#FFFF00'
        }
      }
    ]);
  });

  it('applies Word theme tint and shade transforms to concrete RGB colours', () => {
    const documentXml = `<w:document xmlns:w="${DOCUMENT_NS}"><w:body><w:p>
      <w:r><w:rPr><w:color w:themeColor="accent1" w:themeTint="99"/></w:rPr><w:t>Tint</w:t></w:r>
      <w:r><w:rPr><w:color w:themeColor="accent2" w:themeShade="BF"/></w:rPr><w:t>Shade</w:t></w:r>
    </w:p></w:body></w:document>`;
    const stylesXml = `<w:styles xmlns:w="${DOCUMENT_NS}"/>`;
    const themeXml = `<a:theme xmlns:a="${DRAWING_NS}"><a:themeElements><a:clrScheme name="Exam">
      <a:accent1><a:srgbClr val="4F81BD"/></a:accent1>
      <a:accent2><a:srgbClr val="C0504D"/></a:accent2>
    </a:clrScheme></a:themeElements></a:theme>`;

    const formatting = readDocumentFormatting(documentXml, stylesXml, themeXml);
    const colors = formatting.paragraphsByBlock.get(0)?.map((segment) => segment.formatting.color);

    expect(colors).toEqual(['#95B3D7', '#943634']);
  });

  it('does not apply paragraph-mark formatting to paragraph content', () => {
    const documentXml = `<w:document xmlns:w="${DOCUMENT_NS}"><w:body><w:p>
      <w:pPr><w:rPr><w:u/><w:color w:val="FF0000"/></w:rPr></w:pPr>
      <w:r><w:t>Plain answer</w:t></w:r>
    </w:p></w:body></w:document>`;

    const formatting = readDocumentFormatting(documentXml, null, null);

    expect(formatting.paragraphsByBlock.get(0)).toEqual([
      {
        text: 'Plain answer',
        formatting: {
          bold: false,
          italic: false,
          underline: false,
          strikethrough: false,
          color: null,
          highlight: null
        }
      }
    ]);
  });

  it('resolves theme-backed shading through themeFill attributes', () => {
    const documentXml = `<w:document xmlns:w="${DOCUMENT_NS}"><w:body><w:p>
      <w:r><w:rPr><w:shd w:val="clear" w:themeFill="accent1" w:themeFillTint="99"/></w:rPr><w:t>Shaded</w:t></w:r>
    </w:p></w:body></w:document>`;
    const themeXml = `<a:theme xmlns:a="${DRAWING_NS}"><a:themeElements><a:clrScheme name="Exam">
      <a:accent1><a:srgbClr val="4F81BD"/></a:accent1>
    </a:clrScheme></a:themeElements></a:theme>`;

    const formatting = readDocumentFormatting(documentXml, null, themeXml);

    expect(formatting.paragraphsByBlock.get(0)?.[0]?.formatting.highlight).toBe('#95B3D7');
  });

  it('uses the concrete fallback of a system theme colour', () => {
    const documentXml = `<w:document xmlns:w="${DOCUMENT_NS}"><w:body><w:p>
      <w:r><w:rPr><w:color w:themeColor="text1"/></w:rPr><w:t>System colour</w:t></w:r>
    </w:p></w:body></w:document>`;
    const themeXml = `<a:theme xmlns:a="${DRAWING_NS}"><a:themeElements><a:clrScheme name="Exam">
      <a:dk1><a:sysClr val="windowText" lastClr="123456"/></a:dk1>
    </a:clrScheme></a:themeElements></a:theme>`;

    const formatting = readDocumentFormatting(documentXml, null, themeXml);

    expect(formatting.paragraphsByBlock.get(0)?.[0]?.formatting.color).toBe('#123456');
  });
});
