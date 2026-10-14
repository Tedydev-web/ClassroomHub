import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readExamDeviceSignals } from './exam-device-signals';

function stubLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value)
  });
  return store;
}

function stubIndexedDb(saved: string | null, { hang = false } = {}) {
  const writes: string[] = [];
  const request = <T>(result: T) => {
    const pending: { result: T; onsuccess?: () => void; onerror?: () => void } = { result };
    if (!hang) setTimeout(() => pending.onsuccess?.());
    return pending;
  };
  const database = {
    transaction: () => ({
      objectStore: () => ({
        get: () => request(saved),
        put: (value: string) => {
          writes.push(value);
          return request(undefined);
        }
      })
    })
  };
  vi.stubGlobal('indexedDB', { open: () => request(database) });
  return writes;
}

describe('readExamDeviceSignals', () => {
  beforeEach(() => {
    vi.stubGlobal('screen', { width: 390, height: 844 });
    vi.stubGlobal('devicePixelRatio', 3);
    vi.stubGlobal('navigator', { language: 'vi-VN', platform: 'iPhone', hardwareConcurrency: 6, maxTouchPoints: 5 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('keeps the id this browser already has', async () => {
    stubLocalStorage({ cio_exam_device: 'kept-id' });
    stubIndexedDb(null);

    expect((await readExamDeviceSignals()).id).toBe('kept-id');
  });

  it('brings the id back from IndexedDB when localStorage was cleared, and writes it back', async () => {
    const local = stubLocalStorage();
    stubIndexedDb('backup-id');

    expect((await readExamDeviceSignals()).id).toBe('backup-id');
    expect(local.get('cio_exam_device')).toBe('backup-id');
  });

  it('makes a new id when the browser has none, and keeps it in both places', async () => {
    const local = stubLocalStorage();
    const indexed = stubIndexedDb(null);

    const { id } = await readExamDeviceSignals();

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(local.get('cio_exam_device')).toBe(id);
    expect(indexed).toEqual([id]);
  });

  it('never holds up the start when IndexedDB does not answer', async () => {
    vi.useFakeTimers();
    stubLocalStorage({ cio_exam_device: 'kept-id' });
    stubIndexedDb(null, { hang: true });

    const signals = readExamDeviceSignals();
    await vi.advanceTimersByTimeAsync(2000);

    expect((await signals).id).toBe('kept-id');
  });

  it('still answers where storage is blocked altogether', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      }
    });
    vi.stubGlobal('indexedDB', undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect((await readExamDeviceSignals()).id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('describes the device coarsely, from what every page can read', async () => {
    stubLocalStorage({ cio_exam_device: 'kept-id' });
    stubIndexedDb(null);

    expect((await readExamDeviceSignals()).fingerprint).toMatch(/^390x844\|3\|.+\|vi-VN\|iPhone\|6\|5$/);
  });
});
