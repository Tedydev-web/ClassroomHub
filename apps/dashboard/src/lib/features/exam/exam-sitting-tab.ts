type SittingTabMessage = { type: 'claim' | 'released'; tabId: string };

export type SittingTabHandlers = {
  onTakenElsewhere: () => Promise<void> | void;
  onReleasedToUs: () => void;
};

export type SittingTab = { claim: () => void; close: () => void };

export function holdSittingTab(slug: string, handlers: SittingTabHandlers): SittingTab {
  if (typeof BroadcastChannel === 'undefined') return { claim: () => {}, close: () => {} };

  const tabId = crypto.randomUUID();
  const channel = new BroadcastChannel(`cio-exam:${slug}`);

  channel.onmessage = async (event: MessageEvent<SittingTabMessage>) => {
    const message = event.data;
    if (!message || message.tabId === tabId) return;

    if (message.type === 'claim') {
      await handlers.onTakenElsewhere();
      channel.postMessage({ type: 'released', tabId } satisfies SittingTabMessage);
    } else if (message.type === 'released') {
      handlers.onReleasedToUs();
    }
  };

  return {
    claim: () => channel.postMessage({ type: 'claim', tabId } satisfies SittingTabMessage),
    close: () => channel.close()
  };
}
