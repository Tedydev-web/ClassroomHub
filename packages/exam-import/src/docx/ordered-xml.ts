import { XMLParser } from 'fast-xml-parser';

/** preserveOrder node produced by fast-xml-parser. */
export type OrderedNode = Record<string, unknown>;

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_'
});

export function parseOrderedXml(xml: string): OrderedNode[] {
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
    if (Object.hasOwn(node, key)) found.push(node);
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
    if (direct.length > 0 || Object.hasOwn(node, key)) return direct;

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
    const textContent = children(node, 'w:t');
    if (textContent.length > 0 || Object.hasOwn(node, 'w:t')) {
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
