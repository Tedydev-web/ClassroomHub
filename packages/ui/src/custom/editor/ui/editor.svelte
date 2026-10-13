<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import type { EdraEditorProps } from '../types';
  import initEditor from '../editor';
  import { focusEditor } from '../utils';
  import { cn } from '$src/tools';
  import { ImagePlaceholder } from '../extensions/image/ImagePlaceholder';
  import ImagePlaceholderComp from './components/ImagePlaceholder.svelte';
  import { ImageExtended } from '../extensions/image/ImageExtended';
  import ImageExtendedComp from './components/ImageExtended.svelte';
  import { VideoPlaceholder } from '../extensions/video/VideoPlaceholder';
  import VideoPlaceHolderComp from './components/VideoPlaceholder.svelte';
  import { VideoExtended } from '../extensions/video/VideoExtended';
  import VideoExtendedComp from './components/VideoExtended.svelte';
  import { AudioPlaceholder } from '../extensions/audio/AudioPlaceholder';
  import { AudioExtended } from '../extensions/audio/AudiExtended';
  import AudioPlaceHolderComp from './components/AudioPlaceHolder.svelte';
  import AudioExtendedComp from './components/AudioExtended.svelte';
  import { IFramePlaceholder } from '../extensions/iframe/IFramePlaceholder';
  import { IFrameExtended } from '../extensions/iframe/IFrameExtended';
  import IFramePlaceHolderComp from './components/IFramePlaceHolder.svelte';
  import IFrameExtendedComp from './components/IFrameExtended.svelte';
  import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
  import { all, createLowlight } from 'lowlight';
  import { SvelteNodeViewRenderer } from 'svelte-tiptap';
  import CodeBlock from './components/CodeBlock.svelte';
  import TableCol from './menus/TableCol.svelte';
  import TableRow from './menus/TableRow.svelte';
  import Link from './menus/Link.svelte';
  import slashcommand from '../extensions/slash-command/slashcommand';
  import SlashCommandList from './components/SlashCommandList.svelte';
  import ImageUploadModal from './components/image-upload-modal.svelte';

  import '../editor.css';
  import '../extensions/callout/callout.css';
  import './style.css';
  import '../onedark.css';
  import { getEditorVariant } from '../variants';

  const lowlight = createLowlight(all);

  /**
   * Bind the element to the editor
   */
  let element = $state<HTMLElement>();
  let {
    editor = $bindable(),
    editable = true,
    content,
    onUpdate,
    autofocus = false,
    class: className,
    placeholder = '',
    variant = 'full',
    onExternalPaste,
    onImageUpload,
    onSearchUnsplash,
    emailSafe = false
  }: EdraEditorProps = $props();

  const config = $derived(getEditorVariant(variant));

  let isImageModalOpen = $state(false);

  onMount(() => {
    // Image nodes are shared with the email preset; the rest of the node-view
    // extensions need room to lay out, so the variant decides whether the
    // schema admits them at all.
    const imageExtensions = [
      ImagePlaceholder(ImagePlaceholderComp).configure({
        onOpenModal: () => (isImageModalOpen = true)
      }),
      ImageExtended(ImageExtendedComp)
    ];
    const richNodeExtensions = [
      CodeBlockLowlight.configure({
        lowlight
      }).extend({
        addNodeView() {
          return SvelteNodeViewRenderer(CodeBlock);
        }
      }),
      ...imageExtensions,
      VideoPlaceholder(VideoPlaceHolderComp),
      VideoExtended(VideoExtendedComp),
      AudioPlaceholder(AudioPlaceHolderComp),
      AudioExtended(AudioExtendedComp),
      IFramePlaceholder(IFramePlaceHolderComp),
      IFrameExtended(IFrameExtendedComp)
    ];

    editor = initEditor({
      element,
      content,
      variant,
      placeholder,
      onExternalPaste,
      emailSafe,
      extensions: emailSafe
        ? imageExtensions
        : [
            ...(config.allowsRichNodes ? richNodeExtensions : []),
            ...(config.allowsBlockTools ? [slashcommand(SlashCommandList)] : [])
          ],
      options: {
        onUpdate,
        editable,
        autofocus
      }
    });
  });

  onDestroy(() => {
    if (editor) editor.destroy();
  });
</script>

{#if editor && !editor.isDestroyed}
  <Link {editor} />
  <!-- The row/column menus address table nodes, which only the rich variants
       admit into the schema. -->
  {#if config.allowsRichNodes}
    <TableCol {editor} />
    <TableRow {editor} />
  {/if}
{/if}
<div
  bind:this={element}
  role="button"
  tabindex="0"
  onclick={(event) => focusEditor(editor, event)}
  onkeydown={(event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      focusEditor(editor, event);
    }
  }}
  class={cn('edra-editor ui:min-h-0 ui:w-full ui:flex-1 ui:cursor-auto ui:px-4 *:outline-none', className)}
></div>

{#if editor && !editor.isDestroyed}
  <ImageUploadModal {editor} bind:open={isImageModalOpen} {onImageUpload} {onSearchUnsplash} />
{/if}
