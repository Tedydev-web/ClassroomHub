/**
 * What language the exported files are written in, and whether printed sheets carry the key.
 *
 * Both are decisions about a file rather than about the screen, and both are remembered, so
 * a teacher whose default is wrong says so once instead of on every export. They live here
 * rather than in one tab because two screens now offer the same downloads, and a preference
 * a teacher set on one of them should hold on the other.
 */
import { getPersistedLocale } from '$lib/utils/functions/translations';

export type ExamExportLocale = 'vi' | 'en';

/** Only the languages the exports are written in; the interface has more. */
export const EXAM_EXPORT_LOCALES: readonly ExamExportLocale[] = ['vi', 'en'];

const LOCALE_KEY = 'classroomhub_export_locale';
const ANSWER_KEY_KEY = 'classroomhub_export_answer_keys';

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
 * The teacher's own locale is right nearly every time, because a class and its teacher
 * usually share a language. It stays a default because the system cannot know who reads the
 * file: a sheet mailed to a parent is read by somebody who never saw this screen.
 */
export function rememberedExamExportLocale(): ExamExportLocale {
  const stored = readStored(LOCALE_KEY);
  if (stored === 'vi' || stored === 'en') return stored;

  return getPersistedLocale() === 'vi' ? 'vi' : 'en';
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
