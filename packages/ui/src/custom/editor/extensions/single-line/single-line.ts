import { Extension, Node } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';

/**
 * A document that can only ever hold one paragraph. Used for title fields, where
 * the value is rendered inline in lists, headings and table cells — anywhere a
 * second block would break the surrounding layout.
 *
 * Declared here rather than extending `@tiptap/extension-document` so the single
 * dependency this needs stays `@tiptap/core`; the stock document node is exactly
 * this with `content: 'block+'`.
 */
export const SingleLineDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: 'paragraph'
});

/**
 * Collapses a pasted multi-block slice into one line. Without this, pasting two
 * paragraphs into a single-paragraph document silently drops everything after
 * the first block.
 */
function flattenToSingleLine(slice: Slice, separator: PMNode | null): Slice {
  const blocks: Fragment[] = [];

  slice.content.descendants((node) => {
    if (!node.isTextblock) return true;
    if (node.content.size > 0) blocks.push(node.content);
    return false;
  });

  if (blocks.length === 0) {
    // Already inline content (a bare text run), nothing to flatten.
    return slice;
  }

  let joined = Fragment.empty;
  blocks.forEach((block, index) => {
    if (index > 0 && separator) joined = joined.addToEnd(separator);
    joined = joined.append(block);
  });

  return new Slice(joined, 0, 0);
}

/**
 * Turns the editor into a single-line field: Enter is inert (so it can be used
 * by the surrounding form) and pasted blocks are joined rather than truncated.
 */
export const SingleLine = Extension.create({
  name: 'singleLine',

  addKeyboardShortcuts() {
    // Returning true marks the key as handled, which also stops ProseMirror's
    // default paragraph split.
    const swallow = () => true;
    return {
      Enter: swallow,
      'Shift-Enter': swallow,
      'Mod-Enter': swallow
    };
  },

  addProseMirrorPlugins() {
    const { schema } = this.editor;

    return [
      new Plugin({
        key: new PluginKey('singleLinePaste'),
        props: {
          transformPasted(slice) {
            return flattenToSingleLine(slice, schema.text(' '));
          }
        }
      })
    ];
  }
});
