<script lang="ts" module>
  /**
   * When to use this rather than `Item` directly.
   *
   * This is not a second list family: it wraps `Item.Root` and only changes the layout. Use it
   * for full-bleed rows inside one list surface — a divider between rows, no radius of their
   * own, a hover band — such as the courses list. Use `Item` directly for items that stand alone
   * or sit in a grid of cards, each with its own outline, such as the exam list or media cards.
   * The test is the container: one bordered list whose rows share its edges takes this; separate
   * cards take `Item`.
   */
  import { tv, type VariantProps } from 'tailwind-variants';

  export const resourceListRowVariants = tv({
    base: 'ui:flex-nowrap! ui:rounded-none ui:border-0 ui:border-b ui:border-border ui:last:border-b-0 ui:hover:bg-muted/50',
    variants: {
      align: {
        center: 'ui:items-center',
        start: 'ui:items-start'
      },
      /** Tighter block padding than `Item` size alone (e.g. toolbar / “select all” row). */
      density: {
        default: '',
        toolbar: 'ui:gap-2 ui:py-1.5'
      }
    },
    defaultVariants: {
      align: 'center',
      density: 'default'
    }
  });

  export type ResourceListRowAlign = VariantProps<typeof resourceListRowVariants>['align'];
  export type ResourceListRowDensity = VariantProps<typeof resourceListRowVariants>['density'];
</script>

<script lang="ts">
  import * as Item from '../../base/item';
  import { cn, type WithElementRef } from '../../tools';
  import type { ItemSize, ItemVariant } from '../../base/item/item.svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';

  let {
    ref = $bindable(null),
    class: className,
    child,
    children,
    variant = 'outline',
    size = 'sm',
    align = 'center',
    density = 'default',
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    child?: Snippet<[{ props: Record<string, unknown> }]>;
    children?: Snippet;
    variant?: ItemVariant;
    size?: ItemSize;
    align?: ResourceListRowAlign;
    density?: ResourceListRowDensity;
  } = $props();

  const layoutClass = $derived(cn(resourceListRowVariants({ align, density }), className));
</script>

{#if child}
  <Item.Root {variant} {size} data-density={density} {...restProps}>
    {#snippet child({ props })}
      {@render child!({
        props: {
          ...props,
          'data-density': density,
          class: cn(props.class as string | undefined, layoutClass)
        }
      })}
    {/snippet}
  </Item.Root>
{:else}
  <Item.Root bind:ref {variant} {size} class={layoutClass} data-density={density} {...restProps}>
    {@render children?.()}
  </Item.Root>
{/if}
