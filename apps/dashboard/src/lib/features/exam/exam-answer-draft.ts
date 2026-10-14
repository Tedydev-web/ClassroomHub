import type { PendingAnswer } from './exam-autosave';

export type ExamAnswerDraft = Record<number, unknown>;

const DATABASE = 'cio-exam-drafts';
const STORE = 'answers';

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest): Promise<unknown> {
  const database = await openStore();
  const transaction = database.transaction(STORE, mode);
  const request = work(transaction.objectStore(STORE));

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function saveExamDraft(attemptId: string, draft: ExamAnswerDraft): Promise<void> {
  if (typeof indexedDB === 'undefined') return;

  try {
    await run('readwrite', (store) => store.put(draft, attemptId));
  } catch (error) {
    console.warn('Exam answers not kept on this device:', error);
  }
}

export async function readExamDraft(attemptId: string): Promise<ExamAnswerDraft> {
  if (typeof indexedDB === 'undefined') return {};

  try {
    const draft = await run('readonly', (store) => store.get(attemptId));
    return draft && typeof draft === 'object' ? (draft as ExamAnswerDraft) : {};
  } catch (error) {
    console.warn('Exam answers kept on this device could not be read:', error);
    return {};
  }
}

export async function clearExamDraft(attemptId: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;

  try {
    await run('readwrite', (store) => store.delete(attemptId));
  } catch (error) {
    console.warn('Exam answers kept on this device could not be cleared:', error);
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function answersMissingFromServer(saved: PendingAnswer[], draft: ExamAnswerDraft): PendingAnswer[] {
  const onServer = new Map(saved.map((answer) => [answer.questionId, canonical(answer.answerData)]));

  return Object.entries(draft)
    .map(([questionId, answerData]) => ({ questionId: Number(questionId), answerData }))
    .filter((answer) => onServer.get(answer.questionId) !== canonical(answer.answerData));
}
