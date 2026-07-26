<script lang="ts">
  import type { HTMLContent, Editor } from '@tiptap/core';
  import type { Transaction } from '@tiptap/pm/state';
  import { EdraEditor, EdraToolBar, EdraBubbleMenu, EdraDragHandleExtended } from './ui';
  import PasteFormatNotice from './ui/components/PasteFormatNotice.svelte';
  import EdraToolTip from './ui/components/EdraToolTip.svelte';
  import { Button } from '$src/base/button';
  import { fullscreenPortal, lockBodyScroll } from './ui/fullscreen-portal';
  import { convertLastPasteToPlainText, dismissSmartPaste } from './extensions/smart-paste/smart-paste';
  import type { SmartPastePreview } from './extensions/smart-paste/smart-paste';
  import { getEditorVariant, type EditorVariant } from './variants';
  import Maximize from '@lucide/svelte/icons/maximize-2';
  import Minimize from '@lucide/svelte/icons/minimize-2';
  import { slide } from 'svelte/transition';
  import { cn } from '$src/tools';

  interface Props {
    // Content of the editor
    content?: HTMLContent;
    // How much of the editor to expose — see `variants.ts`
    variant?: EditorVariant;
    // Whether the toolbar should be visible
    showToolBar?: boolean;
    // Whether the editor is editable
    editable?: boolean;
    // Whether to offer the expand-to-fullscreen control (defaults per variant)
    expandable?: boolean;
    // Whether the editor is currently expanded
    expanded?: boolean;
    // Whether to enable localStorage persistence
    enablePersistence?: boolean;
    // localStorage key for content persistence
    contentStorageKey?: string;
    // localStorage key for editable state persistence
    editableStorageKey?: string;
    // CSS class for the editor wrapper
    class?: string;
    // CSS class for the editor itself
    editorClass?: string;
    // Placeholder text for the editor
    placeholder?: string | ((node: any) => string);
    // Translated copy for the controls this component owns
    labels?: {
      expand?: string;
      collapse?: string;
      keptFormatting?: string;
      pasteAsPlainText?: string;
      dismiss?: string;
    };
    // Callback functions
    onContentChange?: (content: HTMLContent) => void;
    onEditorReady?: (editor: Editor) => void;
    onEditorDestroy?: () => void;
  }

  let {
    content = $bindable(''),
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
    placeholder,
    labels,
    onContentChange,
    onEditorReady
  }: Props = $props();

  let editor = $state<Editor>();
  let pastePreview = $state<SmartPastePreview | null>(null);

  const config = $derived(getEditorVariant(variant));
  const canExpand = $derived(expandable ?? config.expandableByDefault);

  // Browser detection
  const browser = typeof window !== 'undefined';

  function normalizeEditorContent(value: HTMLContent | undefined): string {
    const html = String(value ?? '').trim();

    if (html === '' || html === '<p></p>' || html === '<p><br></p>') return '';

    return html;
  }

  // Handle content persistence
  $effect(() => {
    if (enablePersistence && browser && content) {
      localStorage.setItem(contentStorageKey, JSON.stringify(content));
    }
  });

  // Handle editable state persistence
  $effect(() => {
    if (enablePersistence && browser) {
      localStorage.setItem(editableStorageKey, editable.toString());
    }
  });

  // Load persisted content and editable state on mount
  $effect(() => {
    if (enablePersistence && browser) {
      try {
        // Load content
        const rawContentString = localStorage.getItem(contentStorageKey);
        if (rawContentString !== null) {
          content = rawContentString;
        }

        // Load editable state
        const rawEditableString = localStorage.getItem(editableStorageKey);
        if (rawEditableString !== null) {
          editable = rawEditableString === 'true';
        }
      } catch (error) {
        console.warn('Failed to load persisted state:', error);
      }
    }
  });

  let isEditorReady = $state(false);
  // Handle editor ready
  $effect(() => {
    if (editor && !isEditorReady) {
      isEditorReady = true;
      onEditorReady?.(editor);
    }
  });

  $effect(() => {
    if (!editor || editor.isDestroyed) return;

    const nextContent = normalizeEditorContent(content);
    const currentContent = normalizeEditorContent(editor.getHTML());

    if (currentContent === nextContent) return;

    editor.commands.setContent(nextContent, false);
  });

  $effect(() => lockBodyScroll(expanded));

  // A collapsed editor must not keep a stale offer alive behind the overlay.
  $effect(() => {
    if (!canExpand && expanded) expanded = false;
  });

  function onUpdate(props: { editor: Editor; transaction: Transaction }) {
    if (props?.editor && !props.editor.isDestroyed) {
      const newContent = props.editor.getHTML();
      content = newContent;
      onContentChange?.(newContent);
    }
  }

  function toggleExpanded() {
    expanded = !expanded;
    // Re-parenting drops the DOM selection; hand focus back so the author can
    // keep typing where they were.
    queueMicrotask(() => editor?.commands.focus());
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !expanded) return;
    event.preventDefault();
    expanded = false;
  }

  function applyPlainTextPaste() {
    if (editor) convertLastPasteToPlainText(editor);
    pastePreview = null;
  }

  function dismissPasteNotice() {
    if (editor) dismissSmartPaste(editor);
    pastePreview = null;
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if browser}
  {#if expanded}
    <!-- Backdrop is a sibling of the portaled editor so both land on body and
         stack predictably; clicking it collapses, matching dialog conventions. -->
    <button
      type="button"
      aria-label={labels?.collapse ?? 'Collapse editor'}
      transition:slide={{ duration: 120 }}
      class="ui:fixed ui:inset-0 ui:z-[70] ui:cursor-default ui:bg-black/50 ui:backdrop-blur-sm"
      onclick={() => (expanded = false)}
    ></button>
  {/if}

  <div
    use:fullscreenPortal={expanded}
    class={cn(
      'ui:bg-background ui:flex ui:size-full ui:w-full ui:flex-col ui:rounded-md ui:border ui:border-dashed',
      expanded
        ? 'ui:fixed ui:inset-4 ui:z-[71] ui:m-auto ui:size-auto ui:h-[calc(100dvh-2rem)] ui:max-w-6xl ui:border-solid ui:shadow-2xl ui:sm:inset-6 ui:sm:h-[calc(100dvh-3rem)]'
        : 'ui:relative ui:z-50',
      className
    )}
  >
    {#if editor && !editor.isDestroyed}
      {#if showToolBar}
        <div transition:slide>
          <EdraToolBar
            class="ui:bg-secondary/50 ui:w-full ui:border-b ui:border-dashed ui:p-0.5"
            {editor}
            excludedCommands={config.excludedCommands}
          >
            {#snippet trailing()}
              {#if canExpand}
                {@const tooltip = expanded ? (labels?.collapse ?? 'Collapse') : (labels?.expand ?? 'Expand')}
                <EdraToolTip {tooltip} shortCut={expanded ? 'Esc' : ''}>
                  <Button variant="ghost" size="icon" aria-label={tooltip} onclick={toggleExpanded}>
                    {#if expanded}
                      <Minimize />
                    {:else}
                      <Maximize />
                    {/if}
                  </Button>
                </EdraToolTip>
              {/if}
            {/snippet}
          </EdraToolBar>
        </div>
      {/if}
      <EdraBubbleMenu {editor} />

      {#if editable && config.allowsBlockTools}
        <EdraDragHandleExtended {editor} />
      {/if}
    {/if}

    <EdraEditor
      class={cn(
        'ui:relative ui:w-full ui:overflow-auto ui:p-4',
        expanded ? 'ui:min-h-0 ui:flex-1' : config.singleLine ? 'ui:h-auto' : 'ui:h-128',
        editorClass
      )}
      bind:editor
      {editable}
      {content}
      {onUpdate}
      {placeholder}
      {variant}
      onExternalPaste={(preview) => (pastePreview = preview)}
    />

    {#if pastePreview && editable}
      <PasteFormatNotice
        source={pastePreview.source}
        labels={{
          keptFormatting: labels?.keptFormatting,
          pasteAsPlainText: labels?.pasteAsPlainText,
          dismiss: labels?.dismiss
        }}
        onPlainText={applyPlainTextPaste}
        onDismiss={dismissPasteNotice}
      />
    {/if}
  </div>
{/if}
