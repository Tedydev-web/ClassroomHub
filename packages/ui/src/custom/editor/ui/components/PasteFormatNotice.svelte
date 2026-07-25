<script lang="ts">
  import { Button } from '$src/base/button';
  import { cn } from '$src/tools';
  import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
  import X from '@lucide/svelte/icons/x';
  import { fly } from 'svelte/transition';
  import type { PasteSource } from '../../extensions/smart-paste/clean-pasted-html';

  interface Props {
    source: PasteSource;
    /** Overridable so the host application can supply translated copy. */
    labels?: {
      keptFormatting?: string;
      pasteAsPlainText?: string;
      dismiss?: string;
      sourceNames?: Partial<Record<PasteSource, string>>;
    };
    onPlainText: () => void;
    onDismiss: () => void;
    class?: string;
  }

  const DEFAULT_SOURCE_NAMES: Record<PasteSource, string> = {
    word: 'Word',
    'google-docs': 'Google Docs',
    apple: 'Pages',
    html: 'the web'
  };

  let { source, labels, onPlainText, onDismiss, class: className = '' }: Props = $props();

  // The source name is rendered as its own element rather than interpolated
  // into the sentence, so the translated copy stays free of placeholders that
  // the ICU parser would try to resolve.
  const sourceName = $derived(labels?.sourceNames?.[source] ?? DEFAULT_SOURCE_NAMES[source]);
  const message = $derived(labels?.keptFormatting ?? 'Formatting kept');
</script>

<!--
  Offered rather than asked. The paste already landed with its formatting
  intact — the common case — so this is a one-click escape hatch instead of a
  modal that would interrupt typing. It disappears on its own once the author
  edits the pasted region, because converting to plain text at that point would
  discard their edits.
-->
<div
  role="status"
  aria-live="polite"
  transition:fly={{ y: 8, duration: 150 }}
  class={cn(
    'ui:bg-popover ui:text-popover-foreground ui:pointer-events-auto ui:absolute ui:right-3 ui:bottom-3 ui:z-20',
    'ui:flex ui:max-w-[calc(100%-1.5rem)] ui:items-center ui:gap-2 ui:rounded-lg ui:border ui:py-1.5 ui:pr-1.5 ui:pl-3 ui:shadow-lg',
    className
  )}
>
  <ClipboardPaste class="ui:text-muted-foreground ui:size-4 ui:shrink-0" />
  <span class="ui:truncate ui:text-xs">{message}</span>
  <span class="ui:text-muted-foreground ui:hidden ui:shrink-0 ui:text-xs ui:sm:inline">· {sourceName}</span>
  <Button variant="secondary" size="sm" class="ui:h-7 ui:shrink-0 ui:text-xs" onclick={onPlainText}>
    {labels?.pasteAsPlainText ?? 'Paste as plain text'}
  </Button>
  <Button
    variant="ghost"
    size="icon"
    class="ui:size-7 ui:shrink-0"
    aria-label={labels?.dismiss ?? 'Dismiss'}
    onclick={onDismiss}
  >
    <X class="ui:size-3.5" />
  </Button>
</div>
