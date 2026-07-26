import { XMLParser } from 'fast-xml-parser';
import { isListNumberFormat, type ListLevelDefinition } from './list-label';

/**
 * Reads `word/numbering.xml` into the list definitions a label needs.
 *
 * Word stores numbering in two indirections: a paragraph names a `numId`, a
 * `numId` points at an `abstractNumId`, and the abstract definition holds the
 * format, template and start value per level. A `numId` may also override
 * individual levels — most often to restart the counter — and ignoring those
 * mislabels every item in the affected list without any visible error.
 */

/** Level definitions for one list, keyed by indent level. */
export type ListDefinition = Map<number, ListLevelDefinition>;

/** All lists in a document, keyed by the `numId` a paragraph references. */
export type ListDefinitions = Map<string, ListDefinition>;

const ATTRIBUTE_PREFIX = '@_';

type XmlNode = Record<string, unknown>;

function attribute(node: unknown, name: string): string | undefined {
  if (typeof node !== 'object' || node === null) return undefined;

  const value = (node as XmlNode)[`${ATTRIBUTE_PREFIX}w:${name}`];

  return value === undefined || value === null ? undefined : String(value);
}

/** fast-xml-parser collapses a single child to an object; callers want a list. */
function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];

  return Array.isArray(value) ? value : [value];
}

function child(node: unknown, name: string): unknown {
  if (typeof node !== 'object' || node === null) return undefined;

  return (node as XmlNode)[`w:${name}`];
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * A level Word cannot describe with a format we render — `ideographDigital`
 * and friends — becomes `none` rather than a guess, so the reader reports an
 * unresolved label instead of an invented one.
 */
function readLevel(levelNode: unknown): { ilvl: number; definition: ListLevelDefinition } | null {
  const ilvl = parseInteger(attribute(levelNode, 'ilvl'), 0);
  const rawFormat = attribute(child(levelNode, 'numFmt'), 'val') ?? 'none';
  const format = isListNumberFormat(rawFormat) ? rawFormat : 'none';
  const text = attribute(child(levelNode, 'lvlText'), 'val') ?? '';
  const start = parseInteger(attribute(child(levelNode, 'start'), 'val'), 1);

  return { ilvl, definition: { format, text, start } };
}

function readAbstractDefinitions(root: unknown): Map<string, ListDefinition> {
  const definitions = new Map<string, ListDefinition>();

  for (const abstractNode of asArray(child(root, 'abstractNum'))) {
    const abstractId = attribute(abstractNode, 'abstractNumId');
    if (abstractId === undefined) continue;

    const levels: ListDefinition = new Map();
    for (const levelNode of asArray(child(abstractNode, 'lvl'))) {
      const level = readLevel(levelNode);
      if (level) levels.set(level.ilvl, level.definition);
    }

    definitions.set(abstractId, levels);
  }

  return definitions;
}

/** Applies a `numId`'s per-level overrides on top of its abstract definition. */
function applyOverrides(base: ListDefinition, numNode: unknown): ListDefinition {
  const overrides = asArray(child(numNode, 'lvlOverride'));
  if (overrides.length === 0) return base;

  const merged: ListDefinition = new Map(base);

  for (const overrideNode of overrides) {
    const ilvl = parseInteger(attribute(overrideNode, 'ilvl'), 0);
    const replacementNode = child(overrideNode, 'lvl');

    if (replacementNode !== undefined) {
      const replacement = readLevel(replacementNode);
      if (replacement) merged.set(ilvl, replacement.definition);
      continue;
    }

    const startOverride = attribute(child(overrideNode, 'startOverride'), 'val');
    const existing = merged.get(ilvl);
    if (startOverride !== undefined && existing) {
      merged.set(ilvl, { ...existing, start: parseInteger(startOverride, existing.start) });
    }
  }

  return merged;
}

export function parseNumberingDefinitions(xml: string): ListDefinitions {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: ATTRIBUTE_PREFIX });
  const document = parser.parse(xml) as XmlNode;
  const root = document['w:numbering'];
  if (root === undefined) return new Map();

  const abstractDefinitions = readAbstractDefinitions(root);
  const definitions: ListDefinitions = new Map();

  for (const numNode of asArray(child(root, 'num'))) {
    const numId = attribute(numNode, 'numId');
    const abstractId = attribute(child(numNode, 'abstractNumId'), 'val');
    if (numId === undefined || abstractId === undefined) continue;

    const base = abstractDefinitions.get(abstractId);
    if (!base) continue;

    definitions.set(numId, applyOverrides(base, numNode));
  }

  return definitions;
}

/** The level definition a paragraph references, or `null` when unknown. */
export function findListLevel(
  definitions: ListDefinitions,
  numId: string,
  indentLevel = 0
): ListLevelDefinition | null {
  return definitions.get(numId)?.get(indentLevel) ?? null;
}
