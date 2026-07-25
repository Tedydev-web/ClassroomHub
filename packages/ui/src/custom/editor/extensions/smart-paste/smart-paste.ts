import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/core';
import {
  cleanPastedHtml,
  detectPasteSource,
  hasMeaningfulFormatting,
  pastedHtmlToPlainText
} from './clean-pasted-html';
import type { PasteSource } from './clean-pasted-html';

export const smartPasteKey = new PluginKey<SmartPasteState>('smartPaste');

/** Details of the most recent external paste, surfaced to the UI. */
export interface SmartPastePreview {
  source: PasteSource;
  plainText: string;
}

interface SmartPasteState {
  /** The document range the paste produced, mapped forward as the doc changes. */
  range: { from: number; to: number } | null;
  preview: SmartPastePreview | null;
}

export interface SmartPasteOptions {
  /**
   * Called after an external paste whose formatting was preserved, so the host
   * can offer the author a one-click switch to plain text. Passing `null`
   * signals the offer is no longer valid (the author edited it or acted on it).
   */
  onExternalPaste?: (preview: SmartPastePreview | null) => void;
}

const EMPTY_STATE: SmartPasteState = { range: null, preview: null };

/**
 * Computes the document range a transaction inserted, expressed in the
 * coordinates of the resulting document. Each step's new range is mapped
 * through the steps that follow it in the same transaction.
 */
function insertedRange(transaction: Transaction): { from: number; to: number } | null {
  let from: number | null = null;
  let to: number | null = null;

  transaction.steps.forEach((_step, index) => {
    const rest = transaction.mapping.slice(index + 1);
    transaction.mapping.maps[index].forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      const mappedStart = rest.map(newStart, -1);
      const mappedEnd = rest.map(newEnd, 1);
      from = from === null ? mappedStart : Math.min(from, mappedStart);
      to = to === null ? mappedEnd : Math.max(to, mappedEnd);
    });
  });

  if (from === null || to === null || to <= from) return null;
  return { from, to };
}

/**
 * Reads the pending paste offer. Returns `null` when the last paste was
 * internal, carried no formatting, or has already been superseded.
 */
export function getSmartPastePreview(state: EditorState): SmartPastePreview | null {
  return smartPasteKey.getState(state)?.preview ?? null;
}

/** Turns plain text into one paragraph per line, preserving blank lines. */
function plainTextToParagraphs(plainText: string) {
  return plainText.split('\n').map((line) => ({
    type: 'paragraph',
    ...(line.trim() === '' ? {} : { content: [{ type: 'text' as const, text: line }] })
  }));
}

/**
 * Replaces the most recent paste with its plain-text projection. Returns false
 * when there is nothing to convert, so callers can keep the UI in sync.
 */
export function convertLastPasteToPlainText(editor: Editor): boolean {
  const pluginState = smartPasteKey.getState(editor.state);
  const range = pluginState?.range;
  const plainText = pluginState?.preview?.plainText;
  if (!range || !plainText) return false;

  const to = Math.min(range.to, editor.state.doc.content.size);
  if (to <= range.from) return false;

  return editor
    .chain()
    .focus()
    .insertContentAt({ from: range.from, to }, plainTextToParagraphs(plainText))
    .command(({ tr }) => {
      tr.setMeta(smartPasteKey, { clear: true });
      return true;
    })
    .run();
}

/** Discards the pending offer without touching the document. */
export function dismissSmartPaste(editor: Editor): void {
  if (editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setMeta(smartPasteKey, { clear: true }));
}

export const SmartPaste = Extension.create<SmartPasteOptions>({
  name: 'smartPaste',

  addProseMirrorPlugins() {
    const notify = this.options.onExternalPaste;

    /**
     * Handed from `transformPastedHTML` to the paste transaction that follows
     * it synchronously. Dispatching a transaction from inside the transform
     * would run while ProseMirror is still parsing the clipboard, so the value
     * is parked here instead.
     */
    let pendingPreview: SmartPastePreview | null = null;

    return [
      new Plugin<SmartPasteState>({
        key: smartPasteKey,

        state: {
          init: () => EMPTY_STATE,

          apply(transaction, value) {
            if (transaction.getMeta(smartPasteKey)?.clear) return EMPTY_STATE;

            if (transaction.getMeta('paste')) {
              const preview = pendingPreview;
              pendingPreview = null;
              if (!preview) return EMPTY_STATE;

              const range = insertedRange(transaction);
              if (!range) return EMPTY_STATE;
              return { range, preview };
            }

            if (!value.range || !transaction.docChanged) return value;

            // Editing inside the pasted region invalidates the offer — swapping
            // in plain text would discard the author's own edits.
            const from = transaction.mapping.map(value.range.from, -1);
            const to = transaction.mapping.map(value.range.to, 1);
            if (to - from !== value.range.to - value.range.from) return EMPTY_STATE;

            return { ...value, range: { from, to } };
          }
        },

        view() {
          let lastNotified: SmartPastePreview | null = null;

          return {
            update(view) {
              const preview = smartPasteKey.getState(view.state)?.preview ?? null;
              if (preview === lastNotified) return;
              lastNotified = preview;
              notify?.(preview);
            },
            destroy() {
              if (lastNotified) notify?.(null);
            }
          };
        },

        props: {
          transformPastedHTML(html) {
            // ProseMirror stamps its own clipboard payloads; content copied
            // inside the editor is already schema-shaped and must pass through
            // untouched or nested nodes get flattened.
            if (html.includes('data-pm-slice')) {
              pendingPreview = null;
              return html;
            }

            const source = detectPasteSource(html);
            const cleaned = cleanPastedHtml(html);

            // Plain web HTML rarely surprises the author; the offer is reserved
            // for word processors, whose formatting is the thing people ask
            // about.
            pendingPreview =
              source !== 'html' && hasMeaningfulFormatting(cleaned)
                ? { source, plainText: pastedHtmlToPlainText(cleaned) }
                : null;

            return cleaned;
          }
        }
      })
    ];
  }
});

export default SmartPaste;
