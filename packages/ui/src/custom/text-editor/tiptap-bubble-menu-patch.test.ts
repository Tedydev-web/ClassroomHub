// @vitest-environment jsdom

import type { Middleware } from '@floating-ui/dom';
import { BubbleMenuView } from '@tiptap/extension-bubble-menu';
import { describe, expect, it } from 'vitest';

type Position = { x: number; y: number };

async function waitForPendingPositions(pendingPositions: Array<(position: Position) => void>, count: number) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (pendingPositions.length === count) return;

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error(`Expected ${count} pending bubble-menu positions, received ${pendingPositions.length}`);
}

describe('Tiptap bubble-menu patch', () => {
  it('ignores a stale async position result after a newer request completes', async () => {
    const pendingPositions: Array<(position: Position) => void> = [];
    const deferredMiddleware: Middleware = {
      name: 'deferred-position',
      fn: () =>
        new Promise<Position>((resolve) => {
          pendingPositions.push(resolve);
        })
    };
    const element = document.createElement('div');
    document.body.append(element);
    const bubbleMenuHarness = {
      editor: { isDestroyed: false },
      element,
      floatingUIOptions: { placement: 'top', strategy: 'absolute' },
      isVisible: true,
      middlewares: [deferredMiddleware],
      updatePositionRequest: 0,
      virtualElement: {
        getBoundingClientRect: () => new DOMRect(0, 0, 10, 10)
      }
    };

    Reflect.apply(BubbleMenuView.prototype.updatePosition, bubbleMenuHarness, []);
    Reflect.apply(BubbleMenuView.prototype.updatePosition, bubbleMenuHarness, []);
    await waitForPendingPositions(pendingPositions, 2);

    pendingPositions[1]({ x: 20, y: 30 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(element.style.left).toBe('20px');
    expect(element.style.top).toBe('30px');

    pendingPositions[0]({ x: 10, y: 15 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(element.style.left).toBe('20px');
    expect(element.style.top).toBe('30px');

    element.remove();
  });
});
