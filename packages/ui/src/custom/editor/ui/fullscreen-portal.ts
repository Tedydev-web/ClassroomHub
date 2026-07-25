/**
 * Moves an element to `document.body` while a flag is on, leaving a placeholder
 * so it can be returned to its original position afterwards.
 *
 * The editor's expanded state needs this because `position: fixed` resolves
 * against the nearest transformed or filtered ancestor, not the viewport — and
 * an editor can be mounted inside a dialog, a card with a hover transform, or a
 * scroll container. Re-parenting is the only way to guarantee a true overlay.
 *
 * The element itself is never recreated, so the ProseMirror view it hosts keeps
 * its document, undo history and node views across the transition.
 */
export function fullscreenPortal(node: HTMLElement, enabled: boolean) {
  const anchor = document.createComment('editor-fullscreen-anchor');
  let portaled = false;

  function apply(shouldPortal: boolean) {
    if (shouldPortal === portaled) return;

    if (shouldPortal) {
      node.parentNode?.insertBefore(anchor, node);
      document.body.appendChild(node);
      portaled = true;
      return;
    }

    anchor.parentNode?.insertBefore(node, anchor);
    anchor.remove();
    portaled = false;
  }

  apply(enabled);

  return {
    update: apply,
    destroy() {
      // Put the node back before Svelte unmounts it, so the framework removes
      // it from the parent it believes owns it.
      apply(false);
      anchor.remove();
    }
  };
}

/**
 * Prevents the page behind the expanded editor from scrolling. Restores the
 * previous value rather than clearing it, so nested locks do not fight.
 */
export function lockBodyScroll(locked: boolean): () => void {
  if (typeof document === 'undefined') return () => {};
  if (!locked) return () => {};

  const previous = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  return () => {
    document.body.style.overflow = previous;
  };
}
