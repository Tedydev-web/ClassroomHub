/**
 * The value contract for fields that accept light formatting but are stored in
 * columns that predate it — question titles, section names.
 *
 * Such a column is read by far more than the editor: list rows, ordering
 * dialogs, CSV exports, grading payloads and AI tools all treat it as a string.
 * Rewriting every one of those to understand markup would be a wide, risky
 * change for a field that is plain text in the overwhelming majority of rows.
 *
 * So the value stays plain text unless the author actually applies formatting.
 * A title typed normally is stored exactly as it is today; only one that needs
 * notation (`H₂O`, `x²`) is promoted to HTML. Readers use `richTextToPlainText`
 * when they need a string and `isRichTextHtml` when they can render markup.
 */
import { sanitizeHtml, stripHtml } from './sanitize';

/** Inline markup worth preserving in a single-line field. */
const FORMATTING_TAGS = /<(strong|b|em|i|u|s|strike|sub|sup|code|a|span|mark)\b/i;

/** The wrapper TipTap emits around a single paragraph and nothing else. */
const BARE_PARAGRAPH = /^<p>([\s\S]*)<\/p>$/i;

/**
 * True when the value carries formatting a plain string could not represent,
 * and so must be rendered as HTML rather than escaped as text.
 */
export function isRichTextHtml(value: string | null | undefined): boolean {
  if (typeof value !== 'string' || value === '') return false;
  return FORMATTING_TAGS.test(value);
}

/**
 * Normalises what a single-line editor produced into the narrowest
 * representation that preserves the author's intent.
 *
 * Returns plain text when nothing but a paragraph wrapper was added, so an
 * ordinary title round-trips through the editor unchanged.
 */
export function normalizeRichTextValue(html: string | null | undefined): string {
  if (typeof html !== 'string') return '';

  const trimmed = html.trim();
  if (trimmed === '' || trimmed === '<p></p>' || trimmed === '<p><br></p>') return '';

  if (isRichTextHtml(trimmed)) return trimmed;

  const paragraph = trimmed.match(BARE_PARAGRAPH);
  const inner = paragraph ? paragraph[1] : trimmed;

  // Only a genuinely single, tag-free paragraph unwraps. `<p>a</p><p>b</p>`
  // also matches the outer pattern because the middle is greedy, and flattening
  // it would silently merge two blocks into one string.
  if (inner.includes('<')) return trimmed;

  return decodeBasicEntities(inner).trim();
}

/**
 * Prepares a stored value for editing. Plain text is escaped so a title that
 * happens to contain `<` or `&` is shown literally rather than parsed as markup.
 */
export function richTextValueToEditorHtml(value: string | null | undefined): string {
  if (typeof value !== 'string' || value.trim() === '') return '';
  if (isRichTextHtml(value)) return value;
  return `<p>${escapeBasicEntities(value)}</p>`;
}

/**
 * Flattens a value to a string, for the readers that cannot render markup:
 * list rows, exports, ordering dialogs, prompts sent to a model.
 */
export function richTextToPlainText(value: string | null | undefined): string {
  if (typeof value !== 'string' || value === '') return '';
  if (!isRichTextHtml(value) && !value.includes('<')) return value;
  return decodeBasicEntities(stripHtml(value)).replace(/\s+/g, ' ').trim();
}

/**
 * Sanitised markup for the readers that can render it. Plain values are escaped
 * so they display literally.
 */
export function richTextToDisplayHtml(value: string | null | undefined): string {
  if (typeof value !== 'string' || value === '') return '';
  if (!isRichTextHtml(value)) return escapeBasicEntities(value);
  return sanitizeHtml(value);
}

function escapeBasicEntities(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}
