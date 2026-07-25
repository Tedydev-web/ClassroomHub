import type { Editor } from '@tiptap/core';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Node } from '@tiptap/pm/model';

/**
 * Check if the current browser is in mac or not
 */
export const isMac =
  typeof window !== 'undefined' && typeof navigator !== 'undefined'
    ? navigator.userAgent.includes('Macintosh') || navigator.userAgent.includes('Mac OS X')
    : false;

export const findColors = (doc: Node) => {
  const hexColor = /(#[0-9a-f]{3,6})\b/gi;
  const decorations: Decoration[] = [];

  doc.descendants((node, position) => {
    if (!node.text) {
      return;
    }

    Array.from(node.text.matchAll(hexColor)).forEach((match) => {
      const color = match[0];
      const index = match.index || 0;
      const from = position + index;
      const to = from + color.length;
      const decoration = Decoration.inline(from, to, {
        class: 'color',
        style: `--color: ${color}`
      });

      decorations.push(decoration);
    });
  });

  return DecorationSet.create(doc, decorations);
};

/**
 * Dupilcate content at the current selection
 * @param editor Editor instance
 * @param node Node to be duplicated
 */
export const duplicateContent = (editor: Editor, node: Node) => {
  const { view } = editor;
  const { state } = view;
  const { selection } = state;

  editor
    .chain()
    .insertContentAt(selection.to, node.toJSON(), {
      updateSelection: true
    })
    .focus(selection.to)
    .run();
};

/**
 * Sets focus on the editor and moves the cursor to the clicked text position,
 * defaulting to the end of the document if the click is outside any text.
 *
 * @param editor - Editor instance
 * @param event - Optional MouseEvent or KeyboardEvent triggering the focus
 */
export function focusEditor(editor: Editor | undefined, event?: MouseEvent | KeyboardEvent) {
  if (!editor) return;
  // Check if there is a text selection already (i.e. a non-empty selection)
  const selection = window.getSelection();
  if (selection && selection.toString().length > 0) {
    // Focus the editor without modifying selection
    editor.chain().focus().run();
    return;
  }
  if (event instanceof MouseEvent) {
    const { clientX, clientY } = event;
    const pos = editor.view.posAtCoords({ left: clientX, top: clientY })?.pos;
    if (pos == null) {
      // If not a valid position, move cursor to the end of the document
      const endPos = editor.state.doc.content.size;
      editor.chain().focus().setTextSelection(endPos).run();
    } else {
      editor.chain().focus().setTextSelection(pos).run();
    }
  } else {
    editor.chain().focus().run();
  }
}
