import { afterEach, describe, expect, it, vi } from 'vitest';

import { shareLink } from './share-link';

function stubDevice({ coarse, share }: { coarse: boolean; share?: (data: ShareData) => Promise<void> }) {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { share, clipboard: { writeText } });
  vi.stubGlobal('matchMedia', () => ({ matches: coarse }));
  return writeText;
}

afterEach(() => vi.unstubAllGlobals());

describe('shareLink', () => {
  it('opens the share sheet on a touch device', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = stubDevice({ coarse: true, share });

    expect(await shareLink('https://x.test/exam/a', 'Đề thi')).toBe('shared');
    expect(share).toHaveBeenCalledWith({ url: 'https://x.test/exam/a', title: 'Đề thi' });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies on a desktop even when the browser can share', async () => {
    const share = vi.fn();
    const writeText = stubDevice({ coarse: false, share });

    expect(await shareLink('https://x.test/exam/a')).toBe('copied');
    expect(share).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith('https://x.test/exam/a');
  });

  it('does nothing more when the person closes the share sheet', async () => {
    const writeText = stubDevice({
      coarse: true,
      share: vi.fn().mockRejectedValue(new DOMException('closed', 'AbortError'))
    });

    expect(await shareLink('https://x.test/exam/a')).toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies when the share sheet refuses', async () => {
    const writeText = stubDevice({
      coarse: true,
      share: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
    });

    expect(await shareLink('https://x.test/exam/a')).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('https://x.test/exam/a');
  });

  it('copies where the browser has no share sheet', async () => {
    const writeText = stubDevice({ coarse: true });

    expect(await shareLink('https://x.test/exam/a')).toBe('copied');
    expect(writeText).toHaveBeenCalled();
  });
});
