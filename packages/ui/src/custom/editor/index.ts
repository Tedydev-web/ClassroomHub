export { default as Editor } from './editor.svelte';
export type { HTMLContent, Content, Editor as TiptapEditor } from '@tiptap/core';
export { getEditorVariant } from './variants';
export type { EditorVariant, EditorVariantConfig } from './variants';
export type { PasteSource } from './extensions/smart-paste/clean-pasted-html';
export type { SmartPastePreview } from './extensions/smart-paste/smart-paste';
