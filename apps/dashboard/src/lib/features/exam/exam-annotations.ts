/**
 * What a candidate marks on their own paper: questions to come back to, and notes against
 * a passage they wanted to remember.
 *
 * Kept on the device, keyed by the attempt. This is working state, not evidence: nobody
 * marks a question for a teacher's benefit, and sending it would make a private scribble
 * into something the school holds. It survives a reload, which is what it has to survive;
 * it does not survive changing device mid-paper, and nothing here pretends otherwise.
 *
 * Storage can be absent or refuse to write — a private window, a browser with site data
 * switched off. Every path here degrades to working-without-persistence rather than
 * throwing, because losing a bookmark must never be able to interrupt an exam.
 */

export type PaperNote = {
  id: string;
  /** The number on the candidate's paper, so a note can be navigated to. */
  questionNumber: number;
  /** The text they had selected, kept so the note can say what it is about. */
  quote: string;
  body: string;
  at: string;
};

export type PaperAnnotations = {
  bookmarks: number[];
  notes: PaperNote[];
};

const EMPTY: PaperAnnotations = { bookmarks: [], notes: [] };

function keyFor(attemptId: string): string {
  return `exam-annotations:${attemptId}`;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Reading the property itself throws where site data is blocked.
    return null;
  }
}

/** Whatever was stored, cleaned of anything that is not the shape we wrote. */
export function readAnnotations(attemptId: string): PaperAnnotations {
  const store = storage();
  if (!store || !attemptId) return EMPTY;

  try {
    const raw = store.getItem(keyFor(attemptId));
    if (!raw) return EMPTY;

    const parsed = JSON.parse(raw) as Partial<PaperAnnotations>;

    return {
      bookmarks: Array.isArray(parsed.bookmarks)
        ? [...new Set(parsed.bookmarks.filter((value): value is number => Number.isInteger(value) && value > 0))].sort(
            (a, b) => a - b
          )
        : [],
      notes: Array.isArray(parsed.notes)
        ? parsed.notes.filter(
            (note): note is PaperNote =>
              Boolean(note) &&
              typeof note.id === 'string' &&
              Number.isInteger(note.questionNumber) &&
              typeof note.body === 'string'
          )
        : []
    };
  } catch {
    // Corrupt or foreign data in our key: start clean rather than crash the paper.
    return EMPTY;
  }
}

export function writeAnnotations(attemptId: string, annotations: PaperAnnotations): void {
  const store = storage();
  if (!store || !attemptId) return;

  try {
    store.setItem(keyFor(attemptId), JSON.stringify(annotations));
  } catch {
    // Quota, or a browser refusing to write. The paper carries on with what is in memory.
  }
}

/** Adds the number, or takes it away if it is already marked. */
export function toggleBookmark(annotations: PaperAnnotations, questionNumber: number): PaperAnnotations {
  if (!Number.isInteger(questionNumber) || questionNumber < 1) return annotations;

  const marked = annotations.bookmarks.includes(questionNumber);

  return {
    ...annotations,
    bookmarks: marked
      ? annotations.bookmarks.filter((value) => value !== questionNumber)
      : [...annotations.bookmarks, questionNumber].sort((a, b) => a - b)
  };
}

/** Trimmed to something a sidebar can show without becoming a wall of text. */
const MAX_QUOTE = 140;

export function addNote(
  annotations: PaperAnnotations,
  note: { questionNumber: number; quote: string; body: string; at?: string }
): PaperAnnotations {
  const body = note.body.trim();
  if (!body || !Number.isInteger(note.questionNumber)) return annotations;

  const quote = note.quote.trim().replace(/\s+/g, ' ');

  return {
    ...annotations,
    notes: [
      ...annotations.notes,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        questionNumber: note.questionNumber,
        quote: quote.length > MAX_QUOTE ? `${quote.slice(0, MAX_QUOTE).trimEnd()}…` : quote,
        body,
        at: note.at ?? new Date().toISOString()
      }
    ]
  };
}

export function removeNote(annotations: PaperAnnotations, id: string): PaperAnnotations {
  return { ...annotations, notes: annotations.notes.filter((note) => note.id !== id) };
}
