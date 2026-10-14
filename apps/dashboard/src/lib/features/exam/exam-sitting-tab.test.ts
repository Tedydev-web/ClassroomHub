import { afterEach, describe, expect, it, vi } from 'vitest';

import { holdSittingTab, type SittingTab } from './exam-sitting-tab';

const open: SittingTab[] = [];

function tab(slug: string, onTakenElsewhere = vi.fn(), onReleasedToUs = vi.fn()) {
  const held = holdSittingTab(slug, { onTakenElsewhere, onReleasedToUs });
  open.push(held);
  return { held, onTakenElsewhere, onReleasedToUs };
}

afterEach(() => {
  while (open.length > 0) open.pop()?.close();
});

describe('holdSittingTab', () => {
  it('tells the tab already sitting the paper that another tab took it, and hands it over', async () => {
    const first = tab('paper-1');
    const second = tab('paper-1');

    second.held.claim();

    await vi.waitFor(() => expect(second.onReleasedToUs).toHaveBeenCalledTimes(1));
    expect(first.onTakenElsewhere).toHaveBeenCalledTimes(1);
    expect(second.onTakenElsewhere).not.toHaveBeenCalled();
  });

  it('finishes saving in the old tab before the new one is told it may continue', async () => {
    const order: string[] = [];
    tab(
      'paper-1',
      vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push('old tab saved');
      })
    );
    const second = tab(
      'paper-1',
      vi.fn(),
      vi.fn(() => order.push('new tab reloads'))
    );

    second.held.claim();

    await vi.waitFor(() => expect(order).toEqual(['old tab saved', 'new tab reloads']));
  });

  it('leaves tabs sitting other papers alone', async () => {
    const other = tab('paper-2');
    const claiming = tab('paper-1');

    claiming.held.claim();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(other.onTakenElsewhere).not.toHaveBeenCalled();
    expect(claiming.onReleasedToUs).not.toHaveBeenCalled();
  });
});
