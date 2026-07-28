import { describe, expect, it } from 'vitest';
import { parseOrderedXml, XmlSafetyError } from '../src/docx/ordered-xml';

describe('ordered XML safety', () => {
  it('rejects DTD and entity declarations before parsing', () => {
    const xml = '<!DOCTYPE root [<!ENTITY secret SYSTEM "file:///etc/passwd">]><root>&secret;</root>';

    expect(() => parseOrderedXml(xml)).toThrowError(
      expect.objectContaining<Partial<XmlSafetyError>>({ code: 'UNSAFE_XML_DECLARATION' })
    );
  });

  it('rejects XML nested beyond the bounded parser depth', () => {
    const xml = `${'<w:p>'.repeat(257)}x${'</w:p>'.repeat(257)}`;

    expect(() => parseOrderedXml(xml)).toThrowError(
      expect.objectContaining<Partial<XmlSafetyError>>({ code: 'XML_TOO_DEEP' })
    );
  });

  it.each(['<root><child></root>', '<root><child></root', '</root>'])(
    'rejects malformed XML instead of passing it to downstream readers: %s',
    (xml) => {
      expect(() => parseOrderedXml(xml)).toThrowError(
        expect.objectContaining<Partial<XmlSafetyError>>({ code: 'MALFORMED_XML' })
      );
    }
  );
});
