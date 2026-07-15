import { XMLParser } from 'fast-xml-parser';
import type { TScormVersion } from '@cio/utils/validation/scorm';

type XmlRecord = Record<string, unknown>;

export type ScormManifestItem = {
  identifier: string;
  parentIdentifier: string | null;
  resourceIdentifier: string | null;
  title: string;
  launchHref: string | null;
  isLaunchable: boolean;
  order: number;
};

export type ParsedScormManifest = {
  identifier: string | null;
  title: string;
  version: TScormVersion;
  entrypoint: string;
  items: ScormManifestItem[];
  warnings: string[];
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  trimValues: true
});

function asRecord(value: unknown): XmlRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as XmlRecord) : null;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];

  return Array.isArray(value) ? value : [value];
}

function asText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') return String(value);

  const record = asRecord(value);
  return record ? asText(record['#text']) : null;
}

function requiredRecord(parent: XmlRecord, key: string): XmlRecord {
  const record = asRecord(parent[key]);
  if (!record) throw new Error(`SCORM manifest is missing ${key}`);

  return record;
}

function detectVersion(manifest: XmlRecord): TScormVersion {
  const metadata = asRecord(manifest.metadata);
  const schemaVersion = asText(metadata?.schemaversion)?.toLowerCase() ?? '';
  if (schemaVersion.includes('2004')) return '2004';
  if (schemaVersion.includes('1.2')) return '1.2';

  return 'unknown';
}

function buildResourceMap(resources: XmlRecord): Map<string, string> {
  const map = new Map<string, string>();
  for (const value of asArray(resources.resource)) {
    const resource = asRecord(value);
    if (!resource) continue;

    const identifier = asText(resource['@_identifier']);
    const href = asText(resource['@_href']);
    if (identifier && href) map.set(identifier, href);
  }

  return map;
}

function collectItems(
  values: unknown,
  resources: Map<string, string>,
  parentIdentifier: string | null,
  items: ScormManifestItem[]
) {
  for (const value of asArray(values)) {
    const item = asRecord(value);
    if (!item) continue;

    const identifier = asText(item['@_identifier']);
    if (!identifier) throw new Error('SCORM manifest item is missing an identifier');

    const resourceIdentifier = asText(item['@_identifierref']);
    const launchHref = resourceIdentifier ? (resources.get(resourceIdentifier) ?? null) : null;
    items.push({
      identifier,
      parentIdentifier,
      resourceIdentifier,
      title: asText(item.title) ?? identifier,
      launchHref,
      isLaunchable: launchHref !== null,
      order: items.length
    });
    collectItems(item.item, resources, identifier, items);
  }
}

export function parseScormManifest(xml: string): ParsedScormManifest {
  if (!xml.trim()) throw new Error('SCORM manifest is empty');

  const parsed: unknown = parser.parse(xml);
  const document = asRecord(parsed);
  const manifest = document ? asRecord(document.manifest) : null;
  if (!manifest) throw new Error('SCORM manifest root element is missing');

  const organizations = requiredRecord(manifest, 'organizations');
  const resources = requiredRecord(manifest, 'resources');
  const resourceMap = buildResourceMap(resources);
  const organization = asRecord(asArray(organizations.organization)[0]);
  if (!organization) throw new Error('SCORM manifest has no organization');

  const items: ScormManifestItem[] = [];
  collectItems(organization.item, resourceMap, null, items);
  const launchableItems = items.filter((item) => item.isLaunchable);
  if (launchableItems.length === 0) throw new Error('SCORM manifest has no launchable items');

  const warnings: string[] = [];
  if (items.some((item) => item.resourceIdentifier && !item.launchHref)) {
    warnings.push('Some manifest items reference resources without a launch href.');
  }

  return {
    identifier: asText(manifest['@_identifier']),
    title: asText(organization.title) ?? launchableItems[0].title,
    version: detectVersion(manifest),
    entrypoint: launchableItems[0].launchHref!,
    items,
    warnings
  };
}
