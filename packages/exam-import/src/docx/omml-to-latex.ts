import { attr, children, findChildren, hasOwn, type OrderedNode } from './ordered-xml';

export type OmmlConversionResult = { success: true; latex: string } | { success: false; reason: string };

class UnsupportedOmmlError extends Error {}

const SYMBOLS: Readonly<Record<string, string>> = {
  '∞': String.raw`\infty `,
  '±': String.raw`\pm `,
  '×': String.raw`\times `,
  '÷': String.raw`\div `,
  '≤': String.raw`\le `,
  '≥': String.raw`\ge `,
  '≠': String.raw`\ne `,
  '≈': String.raw`\approx `,
  '→': String.raw`\to `,
  '∈': String.raw`\in `,
  '∉': String.raw`\notin `,
  '∂': String.raw`\partial `,
  '∇': String.raw`\nabla `,
  '−': '-'
};
const NARY_OPERATORS: Readonly<Record<string, string>> = {
  '∏': String.raw`\prod`,
  '∑': String.raw`\sum`,
  '∫': String.raw`\int`,
  '∬': String.raw`\iint`,
  '∭': String.raw`\iiint`,
  '⋂': String.raw`\bigcap`,
  '⋃': String.raw`\bigcup`
};
const ACCENTS: Readonly<Record<string, string>> = {
  '̂': String.raw`\hat`,
  '̃': String.raw`\tilde`,
  '̄': String.raw`\bar`,
  '˙': String.raw`\dot`,
  '¨': String.raw`\ddot`,
  '⃗': String.raw`\vec`
};

function directWrappers(nodes: OrderedNode[], key: string): OrderedNode[] {
  return nodes.filter((node) => hasOwn(node, key));
}

function directContent(nodes: OrderedNode[], key: string): OrderedNode[] | null {
  const wrapper = directWrappers(nodes, key)[0];

  return wrapper ? children(wrapper, key) : null;
}

function textContent(nodes: OrderedNode[]): string {
  let text = '';

  for (const node of nodes) {
    const value = node['#text'];
    if (typeof value === 'string' || typeof value === 'number') text += String(value);
    for (const [key, childNodes] of Object.entries(node)) {
      if (key === ':@' || key === '#text' || !Array.isArray(childNodes)) continue;
      text += textContent(childNodes as OrderedNode[]);
    }
  }

  return text;
}

function escapeMathText(value: string): string {
  return [...value]
    .map((character) => {
      const symbol = SYMBOLS[character];
      if (symbol) return symbol;
      if (character === '\\') return String.raw`\backslash `;
      if ('{}#$%&_'.includes(character)) return `\\${character}`;

      return character;
    })
    .join('');
}

function propertyValue(nodes: OrderedNode[], property: string, fallback: string): string {
  const element = findChildren(nodes, property)[0];

  return element ? (attr(element, 'm:val') ?? fallback) : fallback;
}

function argument(nodes: OrderedNode[], key: string): string {
  const content = directContent(nodes, key);

  return content ? convertNodes(content) : '';
}

function wrappedArgument(nodes: OrderedNode[], key: string): string {
  return `{${argument(nodes, key)}}`;
}

function scriptBase(nodes: OrderedNode[]): string {
  const base = argument(nodes, 'm:e');

  return base.length === 1 ? base : `{${base}}`;
}

function convertFraction(nodes: OrderedNode[]): string {
  const fractionType = propertyValue(nodes, 'm:type', 'bar');
  const numerator = argument(nodes, 'm:num');
  const denominator = argument(nodes, 'm:den');
  if (fractionType === 'lin') return `${numerator}/${denominator}`;
  if (fractionType === 'noBar') return String.raw`\binom{${numerator}}{${denominator}}`;

  return String.raw`\frac{${numerator}}{${denominator}}`;
}

function convertRadical(nodes: OrderedNode[]): string {
  const base = argument(nodes, 'm:e');
  const degree = argument(nodes, 'm:deg');
  const degreeHidden = propertyValue(nodes, 'm:degHide', degree.length === 0 ? '1' : '0');

  return degreeHidden === '1' || degree.length === 0
    ? String.raw`\sqrt{${base}}`
    : String.raw`\sqrt[${degree}]{${base}}`;
}

function convertNary(nodes: OrderedNode[]): string {
  const character = propertyValue(nodes, 'm:chr', '∫');
  const operator = NARY_OPERATORS[character] ?? escapeMathText(character);
  const subscript = argument(nodes, 'm:sub');
  const superscript = argument(nodes, 'm:sup');
  const expression = argument(nodes, 'm:e');

  return `${operator}${subscript ? `_{${subscript}}` : ''}${superscript ? `^{${superscript}}` : ''}{${expression}}`;
}

function convertDelimiter(nodes: OrderedNode[]): string {
  const opening = propertyValue(nodes, 'm:begChr', '(');
  const closing = propertyValue(nodes, 'm:endChr', ')');
  const separator = propertyValue(nodes, 'm:sepChr', '|');
  const expressions = directWrappers(nodes, 'm:e').map((wrapper) => convertNodes(children(wrapper, 'm:e')));

  return `${escapeMathText(opening)}${expressions.join(escapeMathText(separator))}${escapeMathText(closing)}`;
}

function convertMatrix(nodes: OrderedNode[]): string {
  const rows = directWrappers(nodes, 'm:mr').map((row) => {
    const cells = directWrappers(children(row, 'm:mr'), 'm:e');

    return cells.map((cell) => convertNodes(children(cell, 'm:e'))).join(' & ');
  });

  return String.raw`\begin{matrix}${rows.join(String.raw` \\ `)}\end{matrix}`;
}

function convertEquationArray(nodes: OrderedNode[]): string {
  const rows = directWrappers(nodes, 'm:e').map((row) => convertNodes(children(row, 'm:e')));

  return String.raw`\begin{aligned}${rows.join(String.raw` \\ `)}\end{aligned}`;
}

function convertElement(key: string, nodes: OrderedNode[]): string {
  if (key === '#text') return escapeMathText(textContent(nodes));
  if (key.endsWith('Pr') || key === 'm:brk') return '';

  switch (key) {
    case 'm:oMath':
    case 'm:oMathPara':
    case 'm:e':
    case 'm:num':
    case 'm:den':
    case 'm:sub':
    case 'm:sup':
    case 'm:deg':
    case 'm:lim':
    case 'm:fName':
    case 'm:r':
    case 'w:r':
      return convertNodes(nodes);
    case 'm:t':
    case 'w:t':
      return escapeMathText(textContent(nodes));
    case 'm:f':
      return convertFraction(nodes);
    case 'm:rad':
      return convertRadical(nodes);
    case 'm:sSup':
      return `${scriptBase(nodes)}^${wrappedArgument(nodes, 'm:sup')}`;
    case 'm:sSub':
      return `${scriptBase(nodes)}_${wrappedArgument(nodes, 'm:sub')}`;
    case 'm:sSubSup':
      return `${scriptBase(nodes)}_${wrappedArgument(nodes, 'm:sub')}^${wrappedArgument(nodes, 'm:sup')}`;
    case 'm:sPre':
      return `{}_${wrappedArgument(nodes, 'm:sub')}^${wrappedArgument(nodes, 'm:sup')}${argument(nodes, 'm:e')}`;
    case 'm:nary':
      return convertNary(nodes);
    case 'm:d':
      return convertDelimiter(nodes);
    case 'm:m':
      return convertMatrix(nodes);
    case 'm:eqArr':
      return convertEquationArray(nodes);
    case 'm:acc': {
      const accent = propertyValue(nodes, 'm:chr', '̂');
      const command = ACCENTS[accent];

      return command
        ? `${command}{${argument(nodes, 'm:e')}}`
        : String.raw`\overset{${escapeMathText(accent)}}{${argument(nodes, 'm:e')}}`;
    }
    case 'm:bar': {
      const position = propertyValue(nodes, 'm:pos', 'top');
      const command = position === 'bot' ? String.raw`\underline` : String.raw`\overline`;

      return `${command}{${argument(nodes, 'm:e')}}`;
    }
    case 'm:groupChr': {
      const position = propertyValue(nodes, 'm:pos', 'bot');
      const command = position === 'top' ? String.raw`\overbrace` : String.raw`\underbrace`;

      return `${command}{${argument(nodes, 'm:e')}}`;
    }
    case 'm:limLow':
      return `${scriptBase(nodes)}_{${argument(nodes, 'm:lim')}}`;
    case 'm:limUpp':
      return `${scriptBase(nodes)}^{${argument(nodes, 'm:lim')}}`;
    case 'm:func':
      return String.raw`\operatorname{${argument(nodes, 'm:fName')}}${argument(nodes, 'm:e')}`;
    case 'm:borderBox':
      return String.raw`\boxed{${argument(nodes, 'm:e')}}`;
    case 'm:box':
      return argument(nodes, 'm:e');
    case 'm:phant':
      return String.raw`\phantom{${argument(nodes, 'm:e')}}`;
    default:
      throw new UnsupportedOmmlError(`Unsupported Office Math element: ${key}`);
  }
}

function convertNodes(nodes: OrderedNode[]): string {
  let latex = '';

  for (const node of nodes) {
    for (const [key, value] of Object.entries(node)) {
      if (key === ':@') continue;
      if (key === '#text') {
        if (typeof value === 'string' || typeof value === 'number') latex += escapeMathText(String(value));
        continue;
      }
      if (!Array.isArray(value)) continue;
      latex += convertElement(key, value as OrderedNode[]);
    }
  }

  return latex;
}

export function convertOmmlToLatex(nodes: OrderedNode[]): OmmlConversionResult {
  try {
    const latex = convertNodes(nodes).trim();
    if (latex.length === 0) {
      return { success: false, reason: 'Office Math expression is empty' };
    }

    return { success: true, latex };
  } catch (error) {
    if (error instanceof UnsupportedOmmlError) {
      return { success: false, reason: error.message };
    }

    throw error;
  }
}
