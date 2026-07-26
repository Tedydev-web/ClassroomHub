import { describe, expect, it } from 'vitest';
import { convertOmmlToLatex } from '../src/docx/omml-to-latex';
import { parseOrderedXml } from '../src/docx/ordered-xml';

const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

function convert(body: string) {
  return convertOmmlToLatex(parseOrderedXml(`<m:oMath xmlns:m="${MATH_NS}">${body}</m:oMath>`));
}

describe('Office Math to LaTeX', () => {
  it('converts fractions, superscripts and radicals without flattening their structure', () => {
    const result = convert(
      '<m:f><m:num><m:r><m:t>1</m:t></m:r></m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f>' +
        '<m:r><m:t>+</m:t></m:r>' +
        '<m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup>' +
        '<m:r><m:t>+</m:t></m:r>' +
        '<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:e><m:r><m:t>y</m:t></m:r></m:e></m:rad>'
    );

    expect(result).toEqual({ success: true, latex: String.raw`\frac{1}{2}+x^{2}+\sqrt{y}` });
  });

  it('converts n-ary operators and matrices used in maths exams', () => {
    const result = convert(
      '<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr>' +
        '<m:sub><m:r><m:t>i=1</m:t></m:r></m:sub><m:sup><m:r><m:t>n</m:t></m:r></m:sup>' +
        '<m:e><m:r><m:t>x</m:t></m:r></m:e></m:nary>' +
        '<m:r><m:t>=</m:t></m:r>' +
        '<m:m><m:mr><m:e><m:r><m:t>a</m:t></m:r></m:e><m:e><m:r><m:t>b</m:t></m:r></m:e></m:mr>' +
        '<m:mr><m:e><m:r><m:t>c</m:t></m:r></m:e><m:e><m:r><m:t>d</m:t></m:r></m:e></m:mr></m:m>'
    );

    expect(result).toEqual({
      success: true,
      latex: String.raw`\sum_{i=1}^{n}{x}=\begin{matrix}a & b \\ c & d\end{matrix}`
    });
  });

  it('groups multi-token script bases and emits an empty nucleus for prescripts', () => {
    const result = convert(
      '<m:sSup><m:e><m:r><m:t>ab</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup>' +
        '<m:r><m:t>+</m:t></m:r>' +
        '<m:sPre><m:sub><m:r><m:t>i</m:t></m:r></m:sub><m:sup><m:r><m:t>j</m:t></m:r></m:sup>' +
        '<m:e><m:r><m:t>x</m:t></m:r></m:e></m:sPre>'
    );

    expect(result).toEqual({ success: true, latex: '{ab}^{2}+{}_{i}^{j}x' });
  });

  it('fails closed when an unknown structural element would produce misleading LaTeX', () => {
    const result = convert('<m:unknown><m:r><m:t>x</m:t></m:r></m:unknown>');

    expect(result).toEqual({
      success: false,
      reason: 'Unsupported Office Math element: m:unknown'
    });
  });
});
