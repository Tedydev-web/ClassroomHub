import type { ExerciseQuestionModel } from './exercise-types';
import type { AnswerData } from './answer-data';
import { getTextareaAnswerCharacterCount } from './textarea-validation';

export type MatchingPair = { left: string; right: string };
export type AnswerCoordinate = { x: number; y: number };

/** Shared payload caps, reused by the legacy codecs and the assessment envelope. */
export const MAX_ANSWER_JSON_LENGTH = 1_000_000;
export const MAX_ANSWER_COLLECTION_ITEMS = 500;
export const MAX_ANSWER_ITEM_TEXT_LENGTH = 10_000;
export const MAX_FILE_KEY_LENGTH = 2_048;
export const MAX_FILE_NAME_LENGTH = 512;
export const MAX_MIME_TYPE_LENGTH = 255;
export const MAX_URL_LENGTH = 2_048;

export function isHttpUrl(value: string): boolean {
  try {
    const parsedUrl = new URL(value);
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseJsonRecord(value: string): Record<string, unknown> | null {
  if (value.length > MAX_ANSWER_JSON_LENGTH) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_ANSWER_COLLECTION_ITEMS &&
    value.every((entry) => typeof entry === 'string' && entry.length <= MAX_ANSWER_ITEM_TEXT_LENGTH)
  );
}

export function isUnique<T>(values: readonly T[]): boolean {
  return new Set(values).size === values.length;
}

export function hasMeaningfulAnswerData(answer: AnswerData | null | undefined): boolean {
  if (!answer) return false;

  switch (answer.type) {
    case 'RADIO':
      return Number.isSafeInteger(answer.optionId);
    case 'TRUE_FALSE':
      return typeof answer.value === 'boolean';
    case 'NUMERIC':
    case 'STAR':
      return Number.isFinite(answer.value);
    case 'CHECKBOX':
      return answer.optionIds.length > 0;
    case 'TEXTAREA':
      return getTextareaAnswerCharacterCount(answer.text) > 0;
    case 'SHORT_ANSWER':
      return answer.text.trim().length > 0;
    case 'FILL_BLANK':
      return answer.values.some((value) => value.trim().length > 0);
    case 'WORD_BANK':
      return answer.filledBlanks.length > 0 && answer.filledBlanks.every((value) => value.trim().length > 0);
    case 'FILE_UPLOAD':
      return answer.fileKey.trim().length > 0;
    case 'VIDEO_RECORDING':
      return answer.assetId.trim().length > 0 && answer.storageKey.trim().length > 0;
    case 'MATCHING':
      return answer.pairs.length > 0;
    case 'ORDERING':
      return answer.orderedValues.length > 0;
    case 'LINK':
      return answer.urls.length > 0;
    case 'HOTSPOT':
      return answer.coordinates.length > 0;
    case 'ASSESSMENT_ITEM':
      return answer.response.responses.length > 0;
  }
}

export function getNumericQuestionOptionIds(question: ExerciseQuestionModel): ReadonlySet<number> {
  return new Set(
    (question.options ?? []).map((option) => Number(option.id)).filter((optionId) => Number.isSafeInteger(optionId))
  );
}

export function getOrderingAnswerValues(question: ExerciseQuestionModel): string[] {
  const options = question.options ?? [];
  if (options.length > 0) {
    return options.map((option, index) => String(option.id ?? option.value ?? option.label ?? `ordering-${index + 1}`));
  }

  const items = question.settings?.items;
  return isStringArray(items) ? items.map((item) => item.trim()) : [];
}

export function isExactStringPermutation(values: readonly string[], expected: readonly string[]): boolean {
  if (values.length !== expected.length || !isUnique(values)) return false;

  const expectedValues = new Set(expected);
  return expectedValues.size === expected.length && values.every((value) => expectedValues.has(value));
}

export function matchingPairKey(pair: MatchingPair): string {
  return `${pair.left.trim().toLowerCase()}::${pair.right.trim().toLowerCase()}`;
}

export function readMatchingPairs(value: unknown): MatchingPair[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ANSWER_COLLECTION_ITEMS) return null;

  const pairs: MatchingPair[] = [];
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      typeof entry.left !== 'string' ||
      entry.left.length > MAX_ANSWER_ITEM_TEXT_LENGTH ||
      typeof entry.right !== 'string' ||
      entry.right.length > MAX_ANSWER_ITEM_TEXT_LENGTH
    ) {
      return null;
    }

    const left = entry.left.trim();
    const right = entry.right.trim();
    if (!left || !right) return null;
    pairs.push({ left, right });
  }

  const pairKeys = pairs.map(matchingPairKey);
  return isUnique(pairKeys) ? pairs : null;
}

export function readCoordinates(value: unknown): AnswerCoordinate[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ANSWER_COLLECTION_ITEMS) return null;

  const coordinates: AnswerCoordinate[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.x !== 'number' || typeof entry.y !== 'number') return null;
    if (!Number.isFinite(entry.x) || !Number.isFinite(entry.y)) return null;

    coordinates.push({ x: entry.x, y: entry.y });
  }

  const coordinateKeys = coordinates.map((coordinate) => `${coordinate.x}:${coordinate.y}`);
  return isUnique(coordinateKeys) ? coordinates : null;
}
