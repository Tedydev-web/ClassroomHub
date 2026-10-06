<script lang="ts">
  import XIcon from '@lucide/svelte/icons/x';
  import { getExerciseQuestionLabel, type ExerciseQuestionLabels } from '@cio/question-types';
  import { IconButton } from '../../icon-button';
  import { ImageLightbox, ZoomableImage } from '../../image-lightbox';
  import { getQuestionLightboxLabels } from '../lightbox-labels';

  let {
    src,
    alt,
    variant = 'preview',
    labels,
    onRemove,
    disabled = false,
    removeTooltip = '',
    removeSr = 'Remove image',
    hasAnyImageInOptions = false
  }: {
    src: string | null;
    alt: string;
    variant?: 'preview' | 'take' | 'edit';
    labels?: ExerciseQuestionLabels;
    onRemove?: () => void;
    disabled?: boolean;
    removeTooltip?: string;
    removeSr?: string;
    hasAnyImageInOptions?: boolean;
  } = $props();

  const sizeClass = $derived(variant === 'edit' ? 'ui:h-24 ui:w-24' : 'ui:h-28 ui:w-28');

  /**
   * An image that fails to load falls back to the same muted box a missing one already uses.
   *
   * A `null` src was handled from the start, but a src that 404s was not, so an option whose
   * image had been removed from storage showed the browser's broken-image glyph — to a candidate,
   * mid-question, with no way to tell whether the option was meant to have a picture at all. The
   * placeholder says the same thing the alignment box already says: nothing to see here.
   *
   * Keyed by `src` so a later, working URL is tried rather than inheriting the earlier failure.
   */
  let failedSrc = $state<string | null>(null);
  const isBroken = $derived(src !== null && failedSrc === src);
  let isLightboxOpen = $state(false);
</script>

{#if variant === 'edit'}
  {#if src}
    <div class="ui:group ui:relative {sizeClass} ui:rounded-md ui:border {isBroken ? 'ui:bg-muted' : ''}">
      <div class="ui:absolute ui:inset-0 ui:overflow-hidden ui:rounded-md">
        {#if !isBroken}
          <img {src} {alt} class="ui:h-full ui:w-full ui:object-cover" onerror={() => (failedSrc = src)} />
        {/if}
      </div>
      {#if onRemove}
        <IconButton
          {disabled}
          tooltipClass="ui:absolute ui:right-[-12px] ui:top-[-12px] ui:z-10"
          class="ui:opacity-0 ui:transition-opacity ui:group-hover:opacity-100"
          tooltip={removeTooltip}
          onclick={onRemove}
          size="icon-sm"
        >
          <XIcon />
          <span class="ui:sr-only">{removeSr}</span>
        </IconButton>
      {/if}
    </div>
  {/if}
{:else if hasAnyImageInOptions}
  {#if src && !isBroken}
    <ZoomableImage
      {src}
      {alt}
      enlargeLabel={getExerciseQuestionLabel(labels, 'question.media.enlarge_image', 'Click to enlarge')}
      class="ui:aspect-video"
      onclick={() => (isLightboxOpen = true)}
      onerror={() => (failedSrc = src)}
    />
    <ImageLightbox images={[{ src, alt }]} labels={getQuestionLightboxLabels(labels)} bind:open={isLightboxOpen} />
  {:else}
    <div class="ui:aspect-video ui:w-full ui:rounded-md ui:border ui:bg-muted"></div>
  {/if}
{/if}
