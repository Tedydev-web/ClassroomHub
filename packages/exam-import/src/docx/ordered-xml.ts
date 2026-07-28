import { XMLParser, XMLValidator } from 'fast-xml-parser';

/** preserveOrder node produced by fast-xml-parser. */
export type OrderedNode = Record<string, unknown>;

export function hasOwn(node: OrderedNode, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(node, key);
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  processEntities: true,
  trimValues: false
});

export type XmlSafetyErrorCode = 'UNSAFE_XML_DECLARATION' | 'XML_TOO_DEEP' | 'MALFORMED_XML';

export class XmlSafetyError extends Error {
  constructor(
    message: string,
    readonly code: XmlSafetyErrorCode
  ) {
    super(message);
    this.name = 'XmlSafetyError';
  }
}

const DEFAULT_MAX_XML_DEPTH = 256;

function markupEnd(xml: string, start: number): number {
  let quote: '"' | "'" | null = null;

  for (let index = start; index < xml.length; index++) {
    const character = xml[index];
    if ((character === '"' || character === "'") && quote === null) {
      quote = character;
    } else if (character === quote) {
      quote = null;
    } else if (character === '>' && quote === null) {
      return index;
    }
  }

  return xml.length - 1;
}

export function assertSafeXml(xml: string, maxDepth = DEFAULT_MAX_XML_DEPTH): void {
  let depth = 0;
  let cursor = 0;

  while (cursor < xml.length) {
    const start = xml.indexOf('<', cursor);
    if (start === -1) break;

    if (xml.startsWith('<!--', start)) {
      const end = xml.indexOf('-->', start + 4);
      cursor = end === -1 ? xml.length : end + 3;
      continue;
    }

    if (xml.startsWith('<![CDATA[', start)) {
      const end = xml.indexOf(']]>', start + 9);
      cursor = end === -1 ? xml.length : end + 3;
      continue;
    }

    if (xml.startsWith('<?', start)) {
      const end = xml.indexOf('?>', start + 2);
      cursor = end === -1 ? xml.length : end + 2;
      continue;
    }

    const end = markupEnd(xml, start + 1);
    const markup = xml.slice(start + 1, end).trim();
    if (markup.startsWith('!')) {
      throw new XmlSafetyError('DTD and entity declarations are not allowed in DOCX XML', 'UNSAFE_XML_DECLARATION');
    }

    if (markup.startsWith('/')) {
      depth = Math.max(0, depth - 1);
    } else if (!markup.endsWith('/')) {
      depth++;
      if (depth > maxDepth) {
        throw new XmlSafetyError(`DOCX XML nesting exceeds the limit of ${maxDepth}`, 'XML_TOO_DEEP');
      }
    }

    cursor = end + 1;
  }

  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    const message =
      typeof validation === 'object' && validation !== null && 'err' in validation
        ? String(validation.err.msg)
        : 'Unknown XML validation error';

    throw new XmlSafetyError(`Malformed DOCX XML: ${message}`, 'MALFORMED_XML');
  }
}

export function parseOrderedXml(xml: string, maxDepth?: number): OrderedNode[] {
  assertSafeXml(xml, maxDepth);

  return parser.parse(xml) as OrderedNode[];
}

/** Content held by one wrapper node, e.g. the array under `w:p`. */
export function children(node: OrderedNode, key: string): OrderedNode[] {
  const value = node[key];

  return Array.isArray(value) ? (value as OrderedNode[]) : [];
}

export function attrs(node: OrderedNode): Record<string, unknown> {
  const value = node[':@'];

  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

export function attr(node: OrderedNode, name: string): string | undefined {
  const value = attrs(node)[`@_${name}`];

  return value === undefined || value === null ? undefined : String(value);
}

/** Matching wrapper nodes, preserving attributes stored beside their content. */
export function findChildren(nodes: OrderedNode[], key: string): OrderedNode[] {
  const found: OrderedNode[] = [];

  for (const node of nodes) {
    if (hasOwn(node, key)) found.push(node);
    for (const [childKey, value] of Object.entries(node)) {
      if (childKey === ':@' || !Array.isArray(value)) continue;
      found.push(...findChildren(value as OrderedNode[], key));
    }
  }

  return found;
}

/** Content of the first matching wrapper, or null. */
export function firstChild(nodes: OrderedNode[], key: string): OrderedNode[] | null {
  for (const node of nodes) {
    const direct = children(node, key);
    if (direct.length > 0 || hasOwn(node, key)) return direct;

    for (const [childKey, value] of Object.entries(node)) {
      if (childKey === ':@' || !Array.isArray(value)) continue;
      const nested = firstChild(value as OrderedNode[], key);
      if (nested) return nested;
    }
  }

  return null;
}

/** Text only from `w:t`; coordinates and DrawingML metadata are excluded. */
export function wordText(nodes: OrderedNode[]): string {
  let text = '';

  for (const node of nodes) {
    if (
      hasOwn(node, 'w:drawing') ||
      hasOwn(node, 'w:pict') ||
      hasOwn(node, 'w:object') ||
      hasOwn(node, 'mc:AlternateContent')
    ) {
      continue;
    }

    const textContent = children(node, 'w:t');
    if (textContent.length > 0 || hasOwn(node, 'w:t')) {
      for (const item of textContent) {
        const value = item['#text'];
        if (typeof value === 'string' || typeof value === 'number') text += String(value);
      }
      continue;
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === ':@' || !Array.isArray(value)) continue;
      text += wordText(value as OrderedNode[]);
    }
  }

  return text;
}
