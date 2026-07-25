<script lang="ts">
  import { cn, isRichTextHtml, richTextToDisplayHtml } from '../../tools';

  interface Props {
    title: string;
    class?: string;
  }

  let { title, class: className = '' }: Props = $props();

  // Most titles are plain strings and render as text — including any that
  // contain `<`, which must not be parsed as markup. Only a title the author
  // actually formatted takes the HTML path, and it is sanitised on the way.
  const isRich = $derived(isRichTextHtml(title));
</script>

<h4 class={cn('ui:font-medium', className)}>
  {#if isRich}
    <!-- The paragraph wrapper the editor emits is displayed inline so a rich
         title still occupies one line inside the heading. -->
    <span class="ui:[&_p]:m-0 ui:[&_p]:inline">{@html richTextToDisplayHtml(title)}</span>
  {:else}
    {title}
  {/if}
</h4>
