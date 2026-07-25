/**
 * Normalises HTML coming from an external application (Microsoft Word, Google
 * Docs, Apple Pages, a web page) into markup TipTap can parse without carrying
 * the source application's private styling vocabulary into our documents.
 *
 * This runs *before* ProseMirror parses the clipboard, so anything left here is
 * still subject to the schema — the goal is not security (see `sanitizeHtml`)
 * but fidelity: keep the author's semantic formatting, drop the noise that makes
 * pasted content look broken or leak another product's theme into ours.
 */

/** Where a chunk of pasted HTML came from, inferred from its fingerprints. */
export type PasteSource = 'word' | 'google-docs' | 'apple' | 'html';

/**
 * Inline CSS properties worth carrying over. Everything else is dropped: Word
 * and Google Docs emit dozens of declarations (font stacks, margins, line
 * heights) that fight our own typography, and TipTap ignores most of them
 * anyway. These are the ones our extensions actually parse back into marks.
 */
const KEPT_STYLE_PROPERTIES = new Set([
  'color',
  'background-color',
  'font-weight',
  'font-style',
  'text-decoration',
  'text-decoration-line',
  'text-align',
  'vertical-align'
]);

/** Elements that only ever carry source-application metadata. */
const DROPPED_ELEMENTS = ['style', 'meta', 'link', 'script', 'xml', 'o:p', 'v:shapetype', 'v:shape'];

/**
 * Presentational wrappers that Word and Google Docs nest several levels deep.
 * They are unwrapped (children kept) rather than removed, because the text
 * inside them is the actual content.
 */
const UNWRAPPED_ELEMENTS = ['font', 'o:smarttagtype', 'st1:place', 'st1:country-region'];

const WORD_LIST_MARKER = /^\s*(?:[•▪◦·o§-]|\(?\d+[.)]|\(?[a-z][.)]|\(?[ivxlcdm]+[.)])\s*$/i;

/** Word encodes its own numbering in `mso-list`; the visible marker is a span. */
const ORDERED_MARKER = /^\s*\(?(?:\d+|[a-z]|[ivxlcdm]+)[.)]\s*$/i;

/**
 * Identifies the source application. Used to decide whether a paste is
 * "external enough" to warrant offering the keep-formatting choice.
 */
export function detectPasteSource(html: string): PasteSource {
  // `class\s*=` rather than `class=`: Word emits unquoted attributes and may
  // pad the equals sign, and the repository's prefix linter rewrites any
  // literal `class=` it finds in source.
  if (/urn:schemas-microsoft-com|mso-|<w:WordDocument|class\s*=\s*"?Mso/i.test(html)) return 'word';
  if (/id="docs-internal-guid|docs-internal-guid-/i.test(html)) return 'google-docs';
  if (/class\s*=\s*"?Apple-|-webkit-nbsp-mode/i.test(html)) return 'apple';
  return 'html';
}

/**
 * True when the markup carries formatting a plain-text paste would lose.
 * A paste of `<p>hello</p>` is structurally HTML but visually identical to its
 * text, so prompting the author about it would be noise.
 */
export function hasMeaningfulFormatting(html: string): boolean {
  return /<(?:strong|b|em|i|u|s|strike|h[1-6]|ul|ol|li|table|tr|td|th|blockquote|pre|code|a|img|sub|sup)\b/i.test(html);
}

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

/** Drops `mso-*` and unlisted declarations, keeping the author's real styling. */
function cleanStyleAttribute(element: Element): void {
  const style = element.getAttribute('style');
  if (!style) return;

  const kept = style
    .split(';')
    .map((declaration) => declaration.trim())
    .filter((declaration) => {
      if (!declaration.includes(':')) return false;
      const property = declaration.slice(0, declaration.indexOf(':')).trim().toLowerCase();
      if (property.startsWith('mso-') || property.startsWith('-')) return false;
      return KEPT_STYLE_PROPERTIES.has(property);
    });

  if (kept.length === 0) {
    element.removeAttribute('style');
    return;
  }

  element.setAttribute('style', `${kept.join('; ')};`);
}

function unwrap(element: Element): void {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  parent.removeChild(element);
}

/**
 * Word renders list items as ordinary paragraphs carrying an `mso-list` style,
 * with the bullet or number as literal text in a leading span. Left alone they
 * paste as a wall of paragraphs starting with "1." — so we detect the pattern
 * and rebuild real `<ul>`/`<ol>` structures.
 */
function isWordListParagraph(element: Element): boolean {
  if (element.tagName !== 'P') return false;
  const style = element.getAttribute('style') ?? '';
  const className = element.getAttribute('class') ?? '';
  return /mso-list\s*:/i.test(style) || /MsoListParagraph/i.test(className);
}

/** Removes the literal bullet/number span and reports whether it was numeric. */
function stripWordListMarker(paragraph: Element): { ordered: boolean } {
  let ordered = false;

  const markerHosts = Array.from(paragraph.querySelectorAll('span')).filter((span) => {
    const style = span.getAttribute('style') ?? '';
    return /mso-list\s*:\s*Ignore/i.test(style) || WORD_LIST_MARKER.test(span.textContent ?? '');
  });

  for (const host of markerHosts) {
    const text = host.textContent ?? '';
    if (!WORD_LIST_MARKER.test(text)) continue;
    if (ORDERED_MARKER.test(text)) ordered = true;
    host.remove();
  }

  return { ordered };
}

/** Word's indent level lives in `mso-list: lN levelM`; default to the first. */
function wordListLevel(paragraph: Element): number {
  const style = paragraph.getAttribute('style') ?? '';
  const match = style.match(/mso-list\s*:[^;]*level(\d+)/i);
  return match ? Number(match[1]) : 1;
}

/**
 * Groups runs of consecutive Word list paragraphs into nested list elements.
 * Only sibling runs are merged, so unrelated lists elsewhere in the paste stay
 * separate.
 */
function rebuildWordLists(root: Element): void {
  const paragraphs = Array.from(root.querySelectorAll('p')).filter(isWordListParagraph);
  if (paragraphs.length === 0) return;

  const runs: Element[][] = [];
  for (const paragraph of paragraphs) {
    const previousRun = runs[runs.length - 1];
    const previous = previousRun?.[previousRun.length - 1];
    if (previous && previous.nextElementSibling === paragraph) {
      previousRun.push(paragraph);
    } else {
      runs.push([paragraph]);
    }
  }

  const document = root.ownerDocument;

  for (const run of runs) {
    const first = run[0];
    const parent = first.parentNode;
    if (!parent) continue;

    // Level -> the list currently open at that depth, so `level2` items attach
    // to the last `level1` item instead of restarting the list.
    const openLists = new Map<number, Element>();
    let rootList: Element | null = null;

    for (const paragraph of run) {
      const { ordered } = stripWordListMarker(paragraph);
      const level = wordListLevel(paragraph);

      let list = openLists.get(level);
      if (!list) {
        list = document.createElement(ordered ? 'ol' : 'ul');
        if (level === 1 || !openLists.get(level - 1)) {
          if (!rootList) {
            parent.insertBefore(list, first);
            rootList = list;
          } else {
            rootList.appendChild(list);
          }
        } else {
          const parentList = openLists.get(level - 1)!;
          (parentList.lastElementChild ?? parentList).appendChild(list);
        }
        openLists.set(level, list);
        // A shallower level restarts any deeper nesting that follows.
        for (const depth of Array.from(openLists.keys())) {
          if (depth > level) openLists.delete(depth);
        }
      }

      const item = document.createElement('li');
      while (paragraph.firstChild) item.appendChild(paragraph.firstChild);
      list.appendChild(item);
      paragraph.remove();
    }
  }
}

/**
 * Word wraps a heading's text in a span carrying the theme colour and font, so
 * a pasted H2 arrives blue-on-Calibri. Headings own their styling in our
 * typography, so their inline colour is dropped.
 */
function stripHeadingColours(root: Element): void {
  for (const heading of Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'))) {
    heading.removeAttribute('style');
    for (const child of Array.from(heading.querySelectorAll('[style]'))) {
      child.removeAttribute('style');
    }
  }
}

function isEmptyInlineWrapper(element: Element): boolean {
  if (element.tagName !== 'SPAN' && element.tagName !== 'DIV') return false;
  return element.attributes.length === 0;
}

/**
 * Cleans one element in place. Returns `false` when the element was removed, so
 * the caller can stop descending into it.
 */
function cleanElement(element: Element): boolean {
  const tag = element.tagName.toLowerCase();

  if (DROPPED_ELEMENTS.includes(tag) || tag.startsWith('w:') || tag.startsWith('o:') || tag.startsWith('m:')) {
    element.remove();
    return false;
  }

  if (UNWRAPPED_ELEMENTS.includes(tag)) {
    unwrap(element);
    return false;
  }

  // Source-application class names carry no meaning in our schema and would
  // otherwise land in the stored HTML and collide with our own CSS.
  element.removeAttribute('class');
  element.removeAttribute('lang');
  element.removeAttribute('xml:lang');
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.name.startsWith('data-') && attribute.name !== 'data-type') {
      element.removeAttribute(attribute.name);
    }
  }

  cleanStyleAttribute(element);

  return true;
}

function walk(element: Element): void {
  for (const child of Array.from(element.children)) {
    if (cleanElement(child)) walk(child);
  }
}

/** Second pass: collapse wrappers left attribute-less by the first pass. */
function collapseEmptyWrappers(root: Element): void {
  for (const element of Array.from(root.querySelectorAll('span, div'))) {
    if (isEmptyInlineWrapper(element)) unwrap(element);
  }
}

/**
 * Word pads its output with non-breaking spaces and empty paragraphs used for
 * page layout. Both survive parsing and show up as stray blank lines.
 */
function normaliseWhitespace(root: Element): void {
  for (const paragraph of Array.from(root.querySelectorAll('p'))) {
    const text = (paragraph.textContent ?? '').replace(/ /g, ' ').trim();
    if (text === '' && paragraph.children.length === 0) paragraph.remove();
  }
}

/**
 * Entry point. Returns cleaned HTML, or the input unchanged when no DOM parser
 * is available (server-side rendering) so we never silently drop content.
 */
export function cleanPastedHtml(html: string): string {
  if (typeof html !== 'string' || html.trim() === '') return '';
  if (typeof DOMParser === 'undefined') return html;

  // Conditional comments and XML islands confuse the parser's tree building, so
  // they go before any DOM work.
  const preStripped = html
    .replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '')
    .replace(/<!\[if[\s\S]*?<!\[endif\]>/gi, '')
    .replace(/<\/?xml[^>]*>[\s\S]*?<\/xml>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const parsed = new DOMParser().parseFromString(preStripped, 'text/html');
  const body = parsed.body;
  if (!body) return html;

  // List reconstruction reads the very `class` and `mso-list` fingerprints that
  // `walk` strips, so it has to run against the untouched markup first.
  rebuildWordLists(body);
  walk(body);
  stripHeadingColours(body);
  collapseEmptyWrappers(body);
  normaliseWhitespace(body);

  return body.innerHTML;
}

/**
 * Plain-text projection of pasted HTML, used when the author chooses to drop
 * formatting. Block boundaries become newlines so paragraphs and list items do
 * not run together.
 */
export function pastedHtmlToPlainText(html: string): string {
  if (typeof html !== 'string' || html.trim() === '') return '';
  if (typeof DOMParser === 'undefined') {
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/ /g, ' ')
      .trim();
  }

  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const body = parsed.body;
  if (!body) return '';

  const lines: string[] = [];

  function collect(node: Node): void {
    if (node.nodeType === 3) {
      const text = (node.textContent ?? '').replace(/ /g, ' ');
      if (text.trim() === '') return;
      if (lines.length === 0) lines.push('');
      lines[lines.length - 1] += text;
      return;
    }

    if (!isElement(node)) return;

    const tag = node.tagName.toLowerCase();
    if (DROPPED_ELEMENTS.includes(tag)) return;

    const isBlock = /^(p|div|li|tr|h[1-6]|blockquote|pre|section|article|header|footer)$/.test(tag);
    if (isBlock) lines.push('');
    if (tag === 'br') lines.push('');

    for (const child of Array.from(node.childNodes)) collect(child);
  }

  collect(body);

  return lines
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line, index, all) => line !== '' || (index > 0 && all[index - 1] !== ''))
    .join('\n')
    .trim();
}
