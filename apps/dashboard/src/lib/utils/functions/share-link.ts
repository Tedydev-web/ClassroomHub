export type ShareLinkOutcome = 'shared' | 'copied' | 'cancelled';

function prefersShareSheet(url: string): boolean {
  return (
    typeof navigator.share === 'function' &&
    (navigator.canShare?.({ url }) ?? true) &&
    typeof matchMedia === 'function' &&
    matchMedia('(pointer: coarse)').matches
  );
}

export async function shareLink(url: string, title?: string): Promise<ShareLinkOutcome> {
  if (prefersShareSheet(url)) {
    try {
      await navigator.share({ url, title });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      console.warn('Share sheet unavailable, copying the link instead:', error);
    }
  }

  await navigator.clipboard.writeText(url);
  return 'copied';
}
