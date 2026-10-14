export type ExamDeviceSignals = { id: string; fingerprint: string };

const STORAGE_KEY = 'cio_exam_device';
const DATABASE = 'cio-exam';
const STORE = 'device';
const INDEXED_TIMEOUT_MS = 1000;

function withinTimeout<T>(work: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([work, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), INDEXED_TIMEOUT_MS))]);
}

function readLocal(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeLocal(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch (error) {
    console.warn('Exam device id not kept in localStorage:', error);
  }
}

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readIndexed(): Promise<string | null> {
  try {
    const database = await openStore();

    return await new Promise((resolve) => {
      const request = database.transaction(STORE, 'readonly').objectStore(STORE).get(STORAGE_KEY);
      request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function writeIndexed(id: string): Promise<void> {
  try {
    const database = await openStore();
    const transaction = database.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(id, STORAGE_KEY);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    console.warn('Exam device id not kept in IndexedDB:', error);
  }
}

export function deviceFingerprint(): string {
  const screenSize = typeof screen === 'undefined' ? '' : `${screen.width}x${screen.height}`;

  return [
    screenSize,
    typeof devicePixelRatio === 'number' ? devicePixelRatio : '',
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.language,
    navigator.platform ?? '',
    navigator.hardwareConcurrency ?? '',
    navigator.maxTouchPoints ?? ''
  ].join('|');
}

export async function readExamDeviceSignals(): Promise<ExamDeviceSignals> {
  const id = readLocal() ?? (await withinTimeout(readIndexed(), null)) ?? crypto.randomUUID();

  writeLocal(id);
  await withinTimeout(writeIndexed(id), undefined);

  return { id, fingerprint: deviceFingerprint() };
}
