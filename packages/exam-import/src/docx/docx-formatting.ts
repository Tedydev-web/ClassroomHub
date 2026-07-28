import { emptyFormatting, type RunFormatting } from '../source-run';
import {
  attr,
  children,
  findChildren,
  firstChild,
  hasOwn,
  parseOrderedXml,
  wordText,
  type OrderedNode
} from './ordered-xml';

type FormattingProperties = Partial<RunFormatting>;
type StyleDefinition = {
  basedOn: string | null;
  formatting: FormattingProperties;
};

export type FormattingSegment = {
  text: string;
  formatting: RunFormatting;
};

export type DocumentFormatting = {
  paragraphsByBlock: Map<number, FormattingSegment[]>;
  tableCellsByBlock: Map<number, Map<string, FormattingSegment[]>>;
};

const HEX_COLOR = /^[0-9A-Fa-f]{6}$/;
const FALSE_VALUES = new Set(['0', 'false', 'off', 'none']);
const HIGHLIGHT_COLORS: Readonly<Record<string, string>> = {
  black: '#000000',
  blue: '#0000FF',
  cyan: '#00FFFF',
  darkBlue: '#00008B',
  darkCyan: '#008B8B',
  darkGray: '#A9A9A9',
  darkGreen: '#006400',
  darkMagenta: '#8B008B',
  darkRed: '#8B0000',
  darkYellow: '#808000',
  green: '#00FF00',
  lightGray: '#D3D3D3',
  magenta: '#FF00FF',
  red: '#FF0000',
  white: '#FFFFFF',
  yellow: '#FFFF00'
};
const THEME_ALIASES: Readonly<Record<string, string>> = {
  background1: 'lt1',
  background2: 'lt2',
  dark1: 'dk1',
  dark2: 'dk2',
  followedHyperlink: 'folHlink',
  hyperlink: 'hlink',
  light1: 'lt1',
  light2: 'lt2',
  text1: 'dk1',
  text2: 'dk2'
};

function directWrapper(nodes: OrderedNode[], key: string): OrderedNode | undefined {
  return nodes.find((node) => hasOwn(node, key));
}

function directContent(nodes: OrderedNode[], key: string): OrderedNode[] | null {
  const wrapper = directWrapper(nodes, key);

  return wrapper ? children(wrapper, key) : null;
}

function propertyValue(nodes: OrderedNode[], key: string): string | undefined {
  const property = directWrapper(nodes, key);

  return property ? attr(property, 'w:val') : undefined;
}

function booleanProperty(nodes: OrderedNode[], key: string): boolean | undefined {
  const property = directWrapper(nodes, key);
  if (!property) return undefined;
  const value = attr(property, 'w:val');

  return value === undefined ? true : !FALSE_VALUES.has(value);
}

function rgbToHsl(hex: string): [number, number, number] {
  const red = Number.parseInt(hex.slice(0, 2), 16) / 255;
  const green = Number.parseInt(hex.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(hex.slice(4, 6), 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const lightness = (maximum + minimum) / 2;
  if (maximum === minimum) return [0, 0, lightness];

  const difference = maximum - minimum;
  const saturation = lightness > 0.5 ? difference / (2 - maximum - minimum) : difference / (maximum + minimum);
  let hueDegrees = 0;
  if (maximum === red) hueDegrees = Math.trunc((60 * (green - blue)) / difference);
  if (maximum === green) hueDegrees = 120 + Math.trunc((60 * (blue - red)) / difference);
  if (maximum === blue) hueDegrees = 240 + Math.trunc((60 * (red - green)) / difference);
  if (hueDegrees < 0) hueDegrees += 360;

  return [hueDegrees / 360, saturation, lightness];
}

function hueToRgb(first: number, second: number, hue: number): number {
  let normalizedHue = hue;
  if (normalizedHue < 0) normalizedHue++;
  if (normalizedHue > 1) normalizedHue--;
  if (normalizedHue < 1 / 6) return first + (second - first) * 6 * normalizedHue;
  if (normalizedHue < 1 / 2) return second;
  if (normalizedHue < 2 / 3) return first + (second - first) * (2 / 3 - normalizedHue) * 6;

  return first;
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const channels =
    saturation === 0
      ? [lightness, lightness, lightness]
      : [
          hueToRgb(
            2 * lightness -
              (lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation),
            lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation,
            hue + 1 / 3
          ),
          hueToRgb(
            2 * lightness -
              (lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation),
            lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation,
            hue
          ),
          hueToRgb(
            2 * lightness -
              (lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation),
            lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation,
            hue - 1 / 3
          )
        ];

  return channels
    .map((channel) =>
      Math.floor(Math.max(0, Math.min(1, channel)) * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')
    .toUpperCase();
}

function transformThemeColor(hex: string, tint: string | undefined, shade: string | undefined): string {
  const [hue, saturation, lightness] = rgbToHsl(hex);
  if (tint && /^[0-9A-Fa-f]{2}$/.test(tint)) {
    const factor = Number.parseInt(tint, 16) / 255;

    return hslToHex(hue, saturation, lightness * factor + (1 - factor));
  }
  if (shade && /^[0-9A-Fa-f]{2}$/.test(shade)) {
    const factor = Number.parseInt(shade, 16) / 255;

    return hslToHex(hue, saturation, lightness * factor);
  }

  return hex.toUpperCase();
}

function readThemeColors(themeXml: string | null): Map<string, string> {
  if (themeXml === null) return new Map();
  const parsed = parseOrderedXml(themeXml);
  const scheme = firstChild(parsed, 'a:clrScheme');
  const colors = new Map<string, string>();
  if (!scheme) return colors;

  for (const wrapper of scheme) {
    const key = Object.keys(wrapper).find((name) => name.startsWith('a:') && name !== ':@');
    if (!key) continue;
    const content = children(wrapper, key);
    const srgbColor = directWrapper(content, 'a:srgbClr');
    const systemColor = directWrapper(content, 'a:sysClr');
    const value = srgbColor
      ? attr(srgbColor, 'val')
      : systemColor
        ? (attr(systemColor, 'lastClr') ?? attr(systemColor, 'val'))
        : undefined;
    if (value && HEX_COLOR.test(value)) colors.set(key.slice(2), value.toUpperCase());
  }

  return colors;
}

function readColor(
  property: OrderedNode | undefined,
  themeColors: Map<string, string>,
  source: 'text' | 'fill' = 'text'
): string | null | undefined {
  if (!property) return undefined;
  const themeName = attr(property, source === 'fill' ? 'w:themeFill' : 'w:themeColor');
  if (themeName) {
    const themeKey = THEME_ALIASES[themeName] ?? themeName;
    const themeColor = themeColors.get(themeKey);
    if (themeColor) {
      const tint = attr(property, source === 'fill' ? 'w:themeFillTint' : 'w:themeTint');
      const shade = attr(property, source === 'fill' ? 'w:themeFillShade' : 'w:themeShade');
      const resolved = transformThemeColor(themeColor, tint, shade);

      return `#${resolved}`;
    }
  }

  const value = attr(property, source === 'fill' ? 'w:fill' : 'w:val');
  if (value === 'auto' || value === 'none') return null;

  return value && HEX_COLOR.test(value) ? `#${value.toUpperCase()}` : undefined;
}

function readRunProperties(nodes: OrderedNode[] | null, themeColors: Map<string, string>): FormattingProperties {
  if (!nodes) return {};
  const formatting: FormattingProperties = {};
  const bold = booleanProperty(nodes, 'w:b');
  const italic = booleanProperty(nodes, 'w:i');
  const strike = booleanProperty(nodes, 'w:strike') ?? booleanProperty(nodes, 'w:dstrike');
  const underlineProperty = directWrapper(nodes, 'w:u');
  const color = readColor(directWrapper(nodes, 'w:color'), themeColors);
  const highlightProperty = directWrapper(nodes, 'w:highlight');
  const shading = readColor(directWrapper(nodes, 'w:shd'), themeColors, 'fill');

  if (bold !== undefined) formatting.bold = bold;
  if (italic !== undefined) formatting.italic = italic;
  if (strike !== undefined) formatting.strikethrough = strike;
  if (underlineProperty) formatting.underline = attr(underlineProperty, 'w:val') !== 'none';
  if (color !== undefined) formatting.color = color;
  if (highlightProperty) {
    const value = attr(highlightProperty, 'w:val');
    formatting.highlight = value === 'none' ? null : value ? (HIGHLIGHT_COLORS[value] ?? null) : null;
  } else if (shading !== undefined) {
    formatting.highlight = shading;
  }

  return formatting;
}

function readStyles(
  stylesXml: string | null,
  themeColors: Map<string, string>
): { defaults: FormattingProperties; definitions: Map<string, StyleDefinition> } {
  if (stylesXml === null) return { defaults: {}, definitions: new Map() };
  const parsed = parseOrderedXml(stylesXml);
  const defaultsContent = firstChild(parsed, 'w:rPrDefault');
  const defaults = readRunProperties(defaultsContent ? firstChild(defaultsContent, 'w:rPr') : null, themeColors);
  const definitions = new Map<string, StyleDefinition>();

  for (const style of findChildren(parsed, 'w:style')) {
    const styleId = attr(style, 'w:styleId');
    if (!styleId) continue;
    const content = children(style, 'w:style');
    const basedOn = propertyValue(content, 'w:basedOn') ?? null;
    const runProperties = directContent(content, 'w:rPr');
    definitions.set(styleId, { basedOn, formatting: readRunProperties(runProperties, themeColors) });
  }

  return { defaults, definitions };
}

function resolveStyle(
  styleId: string | null,
  definitions: Map<string, StyleDefinition>,
  resolving = new Set<string>()
): FormattingProperties {
  if (!styleId || resolving.has(styleId)) return {};
  const definition = definitions.get(styleId);
  if (!definition) return {};
  const nextResolving = new Set(resolving);
  nextResolving.add(styleId);

  return {
    ...resolveStyle(definition.basedOn, definitions, nextResolving),
    ...definition.formatting
  };
}

function collectRunWrappers(nodes: OrderedNode[]): OrderedNode[] {
  const runs: OrderedNode[] = [];

  for (const node of nodes) {
    if (hasOwn(node, 'm:oMath') || hasOwn(node, 'm:oMathPara')) continue;
    if (hasOwn(node, 'w:r')) {
      runs.push(node);
      continue;
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === ':@' || !Array.isArray(value)) continue;
      runs.push(...collectRunWrappers(value as OrderedNode[]));
    }
  }

  return runs;
}

function formattingSegments(
  paragraph: OrderedNode[],
  defaults: FormattingProperties,
  definitions: Map<string, StyleDefinition>,
  themeColors: Map<string, string>
): FormattingSegment[] {
  const paragraphProperties = directContent(paragraph, 'w:pPr');
  const paragraphStyleId = paragraphProperties ? (propertyValue(paragraphProperties, 'w:pStyle') ?? null) : null;
  const paragraphFormatting = {
    ...defaults,
    ...resolveStyle(paragraphStyleId, definitions)
  };

  return collectRunWrappers(paragraph).flatMap((run) => {
    const content = children(run, 'w:r');
    const text = wordText(content);
    if (text.length === 0) return [];
    const runProperties = directContent(content, 'w:rPr');
    const characterStyleId = runProperties ? (propertyValue(runProperties, 'w:rStyle') ?? null) : null;
    const formatting: RunFormatting = {
      ...emptyFormatting(),
      ...paragraphFormatting,
      ...resolveStyle(characterStyleId, definitions),
      ...readRunProperties(runProperties, themeColors)
    };

    return [{ text, formatting }];
  });
}

function tableCellKey(row: number, physicalColumn: number): string {
  return `${row}:${physicalColumn}`;
}

export function readDocumentFormatting(
  documentXml: string,
  stylesXml: string | null,
  themeXml: string | null
): DocumentFormatting {
  const themeColors = readThemeColors(themeXml);
  const { defaults, definitions } = readStyles(stylesXml, themeColors);
  const parsed = parseOrderedXml(documentXml);
  const body = firstChild(parsed, 'w:body') ?? [];
  const bodyBlocks = body.filter((node) => children(node, 'w:p').length > 0 || children(node, 'w:tbl').length > 0);
  const paragraphsByBlock = new Map<number, FormattingSegment[]>();
  const tableCellsByBlock = new Map<number, Map<string, FormattingSegment[]>>();

  bodyBlocks.forEach((block, sourceBlockIndex) => {
    const paragraph = children(block, 'w:p');
    if (paragraph.length > 0) {
      paragraphsByBlock.set(sourceBlockIndex, formattingSegments(paragraph, defaults, definitions, themeColors));
    }

    const table = children(block, 'w:tbl');
    if (table.length === 0) return;
    const cells = new Map<string, FormattingSegment[]>();
    const rows = table.filter((node) => hasOwn(node, 'w:tr'));
    rows.forEach((row, rowIndex) => {
      const rowContent = children(row, 'w:tr');
      const cellWrappers = rowContent.filter((node) => hasOwn(node, 'w:tc'));
      cellWrappers.forEach((cell, physicalColumn) => {
        const cellContent = children(cell, 'w:tc');
        const paragraphs = findChildren(cellContent, 'w:p');
        const segments = paragraphs.flatMap((paragraphWrapper) =>
          formattingSegments(children(paragraphWrapper, 'w:p'), defaults, definitions, themeColors)
        );
        cells.set(tableCellKey(rowIndex, physicalColumn), segments);
      });
    });
    tableCellsByBlock.set(sourceBlockIndex, cells);
  });

  return { paragraphsByBlock, tableCellsByBlock };
}

export function getTableCellFormatting(
  formatting: DocumentFormatting,
  sourceBlockIndex: number,
  row: number,
  physicalColumn: number
): FormattingSegment[] {
  return formatting.tableCellsByBlock.get(sourceBlockIndex)?.get(tableCellKey(row, physicalColumn)) ?? [];
}
