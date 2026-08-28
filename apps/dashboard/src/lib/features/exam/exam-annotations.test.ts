import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  addNote,
  readAnnotations,
  removeNote,
  toggleBookmark,
  writeAnnotations,
  type PaperAnnotations
} from './exam-annotations';

const EMPTY: PaperAnnotations = { bookmarks: [], notes: [] };

/**
 * The suite runs in node, which has no storage. A map is enough: what is under test is the
 * shape written and the shape tolerated on the way back, not the browser's implementation.
 */
beforeAll(() => {
  const entries = new Map<string, string>();

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => void entries.set(key, value),
      removeItem: (key: string) => void entries.delete(key),
      clear: () => entries.clear()
    }
  });
});

describe('a candidate marking their own paper', () => {
  beforeEach(() => localStorage.clear());

  it('adds a bookmark and takes it away again', () => {
    const marked = toggleBookmark(EMPTY, 12);
    expect(marked.bookmarks).toEqual([12]);

    expect(toggleBookmark(marked, 12).bookmarks).toEqual([]);
  });

  it('keeps bookmarks in the order the paper numbers them', () => {
    const marked = [33, 2, 17].reduce(toggleBookmark, EMPTY);

    expect(marked.bookmarks).toEqual([2, 17, 33]);
  });

  it('refuses a number that is not a question number', () => {
    expect(toggleBookmark(EMPTY, 0).bookmarks).toEqual([]);
    expect(toggleBookmark(EMPTY, -3).bookmarks).toEqual([]);
    expect(toggleBookmark(EMPTY, 1.5).bookmarks).toEqual([]);
  });

  it('keeps a note with what it was about', () => {
    const withNote = addNote(EMPTY, { questionNumber: 4, quote: '  the   author   argues ', body: 'check tense' });

    expect(withNote.notes).toHaveLength(1);
    expect(withNote.notes[0]).toMatchObject({ questionNumber: 4, quote: 'the author argues', body: 'check tense' });
  });

  it('ignores an empty note rather than storing a blank row', () => {
    expect(addNote(EMPTY, { questionNumber: 4, quote: 'x', body: '   ' }).notes).toEqual([]);
  });

  it('trims a quote long enough to fill the panel', () => {
    const long = 'a'.repeat(400);
    const withNote = addNote(EMPTY, { questionNumber: 1, quote: long, body: 'note' });

    expect(withNote.notes[0].quote.length).toBeLessThanOrEqual(141);
    expect(withNote.notes[0].quote.endsWith('…')).toBe(true);
  });

  it('removes a note by its id', () => {
    const withNote = addNote(EMPTY, { questionNumber: 1, quote: 'q', body: 'note' });

    expect(removeNote(withNote, withNote.notes[0].id).notes).toEqual([]);
  });

  it('survives a round trip through storage', () => {
    const marked = addNote(toggleBookmark(EMPTY, 7), { questionNumber: 7, quote: 'q', body: 'note' });
    writeAnnotations('attempt-1', marked);

    const read = readAnnotations('attempt-1');
    expect(read.bookmarks).toEqual([7]);
    expect(read.notes[0].body).toBe('note');
  });

  it('keeps one attempt out of another', () => {
    writeAnnotations('attempt-1', toggleBookmark(EMPTY, 7));

    expect(readAnnotations('attempt-2')).toEqual(EMPTY);
  });

  it('starts clean when the stored value is not ours', () => {
    localStorage.setItem('exam-annotations:attempt-1', 'not json at all');

    expect(readAnnotations('attempt-1')).toEqual(EMPTY);
  });

  it('drops entries of the wrong shape rather than trusting them', () => {
    localStorage.setItem(
      'exam-annotations:attempt-1',
      JSON.stringify({ bookmarks: [1, 'two', -4, 6, 6], notes: [{ id: 'a' }, null] })
    );

    const read = readAnnotations('attempt-1');
    expect(read.bookmarks).toEqual([1, 6]);
    expect(read.notes).toEqual([]);
  });
});
