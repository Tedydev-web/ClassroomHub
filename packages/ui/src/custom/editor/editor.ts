import { Editor, type Extensions, type EditorOptions, type Content } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Typography from '@tiptap/extension-typography';
import { ColorHighlighter } from './extensions/ColorHighlighter';
import { FontSize, TextStyle, Color } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import { Callout } from './extensions/callout/callout';
import SearchAndReplace from './extensions/FindAndReplace';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Table, TableCell, TableRow, TableHeader } from './extensions/table';
import { Placeholder } from '@tiptap/extensions';
import { Markdown } from '@tiptap/markdown';
import MathMatics from '@tiptap/extension-mathematics';
import { SmartPaste, type SmartPasteOptions } from './extensions/smart-paste/smart-paste';
import { SingleLine, SingleLineDocument } from './extensions/single-line/single-line';
import { getEditorVariant, type EditorVariant } from './variants';

import AutoJoiner from 'tiptap-extension-auto-joiner';
import 'katex/dist/katex.min.css';
import { InlineMathReplacer } from './extensions/InlineMathReplacer';

export interface InitEditorArgs {
  element?: HTMLElement;
  content?: Content;
  /** Node-view backed extensions supplied by the Svelte layer. */
  extensions?: Extensions;
  options?: Partial<EditorOptions>;
  placeholder?: string | ((node: any) => string);
  variant?: EditorVariant;
  /** Notified when an external paste kept its formatting. */
  onExternalPaste?: SmartPasteOptions['onExternalPaste'];
  /** Restricts the schema to markup that renders in email clients. */
  emailSafe?: boolean;
}

function defaultPlaceholder({ node }: { node: { type: { name: string } } }): string {
  if (node.type.name === 'heading') return "What's the title?";
  if (node.type.name === 'paragraph') return 'Press / or write something ...';
  return '';
}

export default ({
  element,
  content,
  extensions,
  options,
  placeholder,
  variant = 'full',
  onExternalPaste,
  emailSafe = false
}: InitEditorArgs) => {
  const config = getEditorVariant(variant);

  const editor = new Editor({
    element,
    content,
    extensions: emailSafe
      ? [
          StarterKit.configure({
            heading: { levels: [1, 2, 3, 4] },
            link: {
              openOnClick: false,
              autolink: true,
              linkOnPaste: true,
              HTMLAttributes: {
                target: '_blank',
                rel: 'noopener noreferrer nofollow'
              }
            },
            codeBlock: false,
            blockquote: false,
            code: false,
            horizontalRule: false,
            strike: false
          }),
          Placeholder.configure({
            emptyEditorClass: 'is-empty',
            placeholder: placeholder || ''
          }),
          TextAlign.configure({ types: ['heading', 'paragraph'] }),
          ...(extensions ?? [])
        ]
      : [
          StarterKit.configure({
            heading: {
              levels: [1, 2, 3, 4]
            },
            link: {
              openOnClick: false,
              autolink: true,
              linkOnPaste: true,
              HTMLAttributes: {
                target: '_blank',
                rel: 'noopener noreferrer nofollow'
              }
            },
            codeBlock: false,
            // A single-line field swaps in a document that admits one paragraph, so
            // the stock one must not also register under the `doc` name.
            ...(config.singleLine ? { document: false as const } : {})
          }),
          ...(config.singleLine ? [SingleLineDocument, SingleLine] : []),
          Callout,
          Highlight.configure({
            multicolor: true
          }),
          Placeholder.configure({
            emptyEditorClass: 'is-empty',
            placeholder: placeholder || defaultPlaceholder
          }),
          Color,
          Subscript,
          Superscript,
          Typography,
          ColorHighlighter,
          TextStyle,
          FontSize,
          TextAlign.configure({
            types: ['heading', 'paragraph']
          }),
          SearchAndReplace,
          InlineMathReplacer,
          MathMatics.configure({
            blockOptions: {
              onClick: (node, pos) => {
                const newCalculation = prompt('Enter new calculation:', node.attrs.latex);
                if (newCalculation) {
                  editor.chain().setNodeSelection(pos).updateBlockMath({ latex: newCalculation }).focus().run();
                }
              }
            },
            inlineOptions: {
              onClick: (node, pos) => {
                const newCalculation = prompt('Enter new calculation:', node.attrs.latex);
                if (newCalculation) {
                  editor.chain().setNodeSelection(pos).updateInlineMath({ latex: newCalculation }).focus().run();
                }
              }
            }
          }),
          SmartPaste.configure({ onExternalPaste }),
          AutoJoiner,
          Markdown,

          // Structure that only makes sense with room to lay it out.
          ...(config.allowsRichNodes
            ? [TaskList, TaskItem.configure({ nested: true }), Table, TableHeader, TableRow, TableCell]
            : []),

          ...(extensions ?? [])
        ],
    ...options
  });

  return editor;
};
