<script module lang="ts">
  // Module-level singleton: one Promise shared across all mounted instances.
  // Dynamic imports are already cached by the JS engine after the first load,
  // but reusing the same Promise avoids redundant microtask chains on remounts.
  let pending: Promise<typeof import('@cio/ui/custom/editor')> | null = null;

  function loadEditor() {
    pending ??= import('@cio/ui/custom/editor');
    return pending;
  }

  /** Warm the editor chunk without mounting an instance (e.g. on newsfeed page load). */
  export function preloadTextEditor() {
    return loadEditor();
  }
</script>

<script lang="ts">
  // Type-only imports are erased at build time — no static TipTap dependency.
  import type { EditorVariant, HTMLContent, TiptapEditor } from '@cio/ui/custom/editor';
  import { cn } from '@cio/ui/tools';
  import { t } from '$lib/utils/functions/translations';
  import { uploadImage } from '$lib/utils/services/upload';
  import { queryUnsplash } from './upload-widget/utils';

  interface Props {
    placeholder?: string | ((node: unknown) => string);
    content?: HTMLContent;
    /**
     * How much of the editor to expose. `full` for long-form bodies, `compact`
     * for prose in a constrained panel, `inline` for single-line titles.
     */
    variant?: EditorVariant;
    showToolBar?: boolean;
    editable?: boolean;
    /** Overrides the variant's default; `inline` fields opt out by default. */
    expandable?: boolean;
    expanded?: boolean;
    enablePersistence?: boolean;
    contentStorageKey?: string;
    editableStorageKey?: string;
    class?: string;
    editorClass?: string;
    onChange?: (content: HTMLContent) => void;
    onReady?: (editor: TiptapEditor) => void;
    onEditorDestroy?: () => void;
  }

  let {
    content = '',
    variant = 'full',
    showToolBar = true,
    editable = true,
    expandable,
    expanded = $bindable(false),
    enablePersistence = false,
    contentStorageKey = 'edra-content',
    editableStorageKey = 'edra-editable',
    class: className = '',
    editorClass = '',
    placeholder = 'Welcome to ClassroomHub',
    onChange,
    onReady,
    onEditorDestroy
  }: Props = $props();

  // The editor package ships English defaults; the app owns the translations.
  const labels = $derived({
    expand: $t('rich_editor.expand'),
    collapse: $t('rich_editor.collapse'),
    keptFormatting: $t('rich_editor.paste_kept_formatting'),
    pasteAsPlainText: $t('rich_editor.paste_as_plain_text'),
    dismiss: $t('rich_editor.dismiss')
  });

  // Prefixed utilities: the skeleton has to match the real editor, which is
  // styled from the UI package's compiled CSS and its theme tokens.
  const skeletonHeight = $derived(variant === 'inline' ? 'ui:h-11' : 'ui:h-128');
</script>

{#await loadEditor()}
  <div
    class={cn('ui:bg-background relative flex w-full flex-col rounded-md border border-dashed', className)}
    aria-busy="true"
    aria-hidden="true"
  >
    {#if showToolBar}
      <div class="ui:h-9 ui:shrink-0 ui:border-b ui:border-dashed ui:bg-muted/50"></div>
    {/if}
    <div
      class={cn(
        'ui:relative ui:w-full ui:overflow-auto ui:p-4 ui:animate-pulse ui:bg-muted/50',
        skeletonHeight,
        editorClass
      )}
    ></div>
  </div>
{:then { Editor }}
  <Editor
    {content}
    {variant}
    {showToolBar}
    {editable}
    {expandable}
    bind:expanded
    {enablePersistence}
    {contentStorageKey}
    {editableStorageKey}
    class={className}
    {editorClass}
    {placeholder}
    {labels}
    onContentChange={onChange}
    onEditorReady={onReady}
    {onEditorDestroy}
    onImageUpload={uploadImage}
    onSearchUnsplash={queryUnsplash}
  />
{/await}
