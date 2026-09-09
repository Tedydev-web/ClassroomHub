/**
 * What language the exported files are written in, and whether printed sheets carry the key.
 *
 * Both are decisions about a file rather than about the screen, and both are remembered, so
 * a teacher whose default is wrong says so once instead of on every export. They live here
 * rather than in one tab because two screens now offer the same downloads, and a preference
 * a teacher set on one of them should hold on the other.
 */
export type ExamExportLocale = 'vi' | 'en';

/** Only the languages the exports are written in; the interface has more. */
export const EXAM_EXPORT_LOCALES: readonly ExamExportLocale[] = ['vi', 'en'];

/** The paper the answer sheet is laid out for; A5 halves the sheet a class hands round. */
export type ExamExportPaper = 'a4' | 'a5';

export const EXAM_EXPORT_PAPERS: readonly ExamExportPaper[] = ['a5', 'a4'];

const LOCALE_KEY = 'classroomhub_export_locale';
const ANSWER_KEY_KEY = 'classroomhub_export_answer_keys';
const PAPER_KEY = 'classroomhub_export_paper';

function readStored(key: string): string | null {
  if (typeof window === 'undefined') return null;

  try {
    return window.localStorage.getItem(key);
  } catch {
    // A browser that refuses storage still exports; it just asks again next time.
    return null;
  }
}

function writeStored(key: string, value: string): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(key, value);
  } catch {
    // As above.
  }
}

/**
 * English by default: the papers are an English course's, so the exported sheet reads in
 * English until a teacher chooses otherwise. It stays a default rather than a fixed value
 * because a teacher may still export in Vietnamese, and that choice is then remembered.
 */
export function rememberedExamExportLocale(): ExamExportLocale {
  const stored = readStored(LOCALE_KEY);
  if (stored === 'vi' || stored === 'en') return stored;

  return 'en';
}

export function storeExamExportLocale(locale: ExamExportLocale): void {
  writeStored(LOCALE_KEY, locale);
}

/**
 * A sheet handed back after marking should say what the right answer was; one handed out
 * before a re-sit must not. Same paper, two different documents, and only the teacher knows
 * which afternoon it is.
 */
export function rememberedExamAnswerKeyChoice(): boolean {
  return readStored(ANSWER_KEY_KEY) !== 'off';
}

export function storeExamAnswerKeyChoice(includeAnswerKey: boolean): void {
  writeStored(ANSWER_KEY_KEY, includeAnswerKey ? 'on' : 'off');
}

/**
 * A5 by default: one sheet handed to a candidate is half a page, so a class of forty is
 * twenty sheets of paper rather than forty. It stays a default a teacher can override to A4
 * when a class marks the small bubbles by hand and wants the room.
 */
export function rememberedExamExportPaper(): ExamExportPaper {
  return readStored(PAPER_KEY) === 'a4' ? 'a4' : 'a5';
}

export function storeExamExportPaper(paper: ExamExportPaper): void {
  writeStored(PAPER_KEY, paper);
}
