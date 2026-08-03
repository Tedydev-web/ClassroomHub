import type { QuestionTypeKey } from './question-type-keys';
import type { ExerciseQuestionModel } from './exercise-types';
import type {
  AnswerData,
  RadioAnswerData,
  CheckboxAnswerData,
  TrueFalseAnswerData,
  ThumbsAnswerData,
  TextareaAnswerData,
  ShortAnswerData,
  NumericAnswerData,
  FillBlankAnswerData,
  WordBankAnswerData,
  FileUploadAnswerData,
  MatchingAnswerData,
  OrderingAnswerData,
  LinkAnswerData,
  HotspotAnswerData,
  StarAnswerData,
  VideoRecordingAnswerData
} from './answer-data';

import { QUESTION_TYPE_KEY } from './question-type-keys';
import { getStarRatingMaxFromSettings, isValidStarRatingValue } from './star-rating-settings';
import {
  MAX_ANSWER_COLLECTION_ITEMS,
  MAX_FILE_KEY_LENGTH,
  MAX_FILE_NAME_LENGTH,
  MAX_MIME_TYPE_LENGTH,
  MAX_URL_LENGTH,
  getNumericQuestionOptionIds,
  getOrderingAnswerValues,
  isExactStringPermutation,
  isHttpUrl,
  isRecord,
  isStringArray,
  isUnique,
  parseJsonRecord,
  readCoordinates,
  readMatchingPairs
} from './question-answer-validation';

export type ApiPayload = { questionId: number; optionId?: number; answer?: string };

export interface AnswerCodec<T extends AnswerData = AnswerData> {
  type: QuestionTypeKey;
  /** Structured AnswerData -> flat API payload for submission */
  toApiPayload(data: T, questionId: number): ApiPayload;
  /** Flat API payload -> AnswerData (for API write path) */
  fromApiPayload(
    payload: { questionId: number; optionId?: number; answer?: string },
    question: ExerciseQuestionModel
  ): T | null;
}

export type AnswerDecodeResult =
  | { success: true; data: AnswerData }
  | { success: false; reason: 'missing' | 'invalid'; message: string };

const TRUE_LABELS = new Set(['true', '1', 'yes']);
const FALSE_LABELS = new Set(['false', '0', 'no']);

function labelToBoolean(label: string): boolean | undefined {
  const normalized = label.trim().toLowerCase();
  if (TRUE_LABELS.has(normalized)) return true;
  if (FALSE_LABELS.has(normalized)) return false;
  return undefined;
}

const RADIO_CODEC: AnswerCodec<RadioAnswerData> = {
  type: 'RADIO',
  toApiPayload(data, questionId) {
    return { questionId, optionId: data.optionId };
  },
  fromApiPayload(payload, question) {
    const optionId = payload.optionId;
    if (optionId === undefined || !Number.isSafeInteger(optionId)) return null;

    const validOptionIds = getNumericQuestionOptionIds(question);
    if (!validOptionIds.has(optionId)) return null;

    return { type: 'RADIO', optionId };
  }
};

const CHECKBOX_CODEC: AnswerCodec<CheckboxAnswerData> = {
  type: 'CHECKBOX',
  toApiPayload(data, questionId) {
    return {
      questionId,
      answer: JSON.stringify({ type: 'CHECKBOX', optionIds: data.optionIds })
    };
  },
  fromApiPayload(payload, question) {
    if (!payload.answer) return null;

    const parsed = parseJsonRecord(payload.answer);
    if (parsed?.type !== 'CHECKBOX' || !Array.isArray(parsed.optionIds) || parsed.optionIds.length === 0) return null;
    if (parsed.optionIds.length > MAX_ANSWER_COLLECTION_ITEMS) return null;
    if (!parsed.optionIds.every((optionId) => typeof optionId === 'number' && Number.isSafeInteger(optionId))) {
      return null;
    }

    const optionIds = parsed.optionIds as number[];
    if (!isUnique(optionIds)) return null;

    const validOptionIds = getNumericQuestionOptionIds(question);
    if (!optionIds.every((optionId) => validOptionIds.has(optionId))) return null;

    return { type: 'CHECKBOX', optionIds };
  }
};

const TRUE_FALSE_CODEC: AnswerCodec<TrueFalseAnswerData> = {
  type: 'TRUE_FALSE',
  toApiPayload(data, questionId) {
    return { questionId, answer: String(data.value) };
  },
  fromApiPayload(payload) {
    if (payload.answer === undefined) return null;
    const resolved = labelToBoolean(payload.answer);
    if (resolved === undefined) return null;
    return { type: 'TRUE_FALSE', value: resolved };
  }
};

const THUMBS_CODEC: AnswerCodec<ThumbsAnswerData> = {
  type: 'THUMBS',
  toApiPayload(data, questionId) {
    return { questionId, answer: String(data.value) };
  },
  fromApiPayload(payload) {
    if (payload.answer === undefined) return null;
    const resolved = labelToBoolean(payload.answer);
    if (resolved === undefined) return null;
    return { type: 'THUMBS', value: resolved };
  }
};

const TEXTAREA_CODEC: AnswerCodec<TextareaAnswerData> = {
  type: 'TEXTAREA',
  toApiPayload(data, questionId) {
    return { questionId, answer: data.text };
  },
  fromApiPayload(payload) {
    if (payload.answer === undefined) return null;
    return { type: 'TEXTAREA', text: payload.answer };
  }
};

const SHORT_ANSWER_CODEC: AnswerCodec<ShortAnswerData> = {
  type: 'SHORT_ANSWER',
  toApiPayload(data, questionId) {
    return { questionId, answer: data.text };
  },
  fromApiPayload(payload) {
    if (payload.answer === undefined) return null;
    return { type: 'SHORT_ANSWER', text: payload.answer };
  }
};

const NUMERIC_CODEC: AnswerCodec<NumericAnswerData> = {
  type: 'NUMERIC',
  toApiPayload(data, questionId) {
    return { questionId, answer: JSON.stringify({ type: 'NUMERIC', value: data.value }) };
  },
  fromApiPayload(payload) {
    if (!payload.answer) return null;

    const parsed = parseJsonRecord(payload.answer);
    if (parsed?.type !== 'NUMERIC' || typeof parsed.value !== 'number' || !Number.isFinite(parsed.value)) return null;

    return { type: 'NUMERIC', value: parsed.value };
  }
};

const FILL_BLANK_CODEC: AnswerCodec<FillBlankAnswerData> = {
  type: 'FILL_BLANK',
  toApiPayload(data, questionId) {
    return { questionId, answer: JSON.stringify({ type: 'FILL_BLANK', answers: data.values }) };
  },
  fromApiPayload(payload, question) {
    if (!payload.answer) return null;

    const parsed = parseJsonRecord(payload.answer);
    if (parsed?.type !== 'FILL_BLANK' || !isStringArray(parsed.answers)) return null;

    const values = parsed.answers.map((value) => value.trim());
    const expectedValues = String(question.settings?.acceptedAnswers ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (expectedValues.length === 0 || values.length !== expectedValues.length) return null;

    return values.some(Boolean) ? { type: 'FILL_BLANK', values } : null;
  }
};

const WORD_BANK_CODEC: AnswerCodec<WordBankAnswerData> = {
  type: 'WORD_BANK',
  toApiPayload(data, questionId) {
    return { questionId, answer: JSON.stringify({ type: 'WORD_BANK', filledBlanks: data.filledBlanks }) };
  },
  fromApiPayload(payload, question) {
    if (!payload.answer) return null;

    const parsed = parseJsonRecord(payload.answer);
    if (parsed?.type !== 'WORD_BANK' || !isStringArray(parsed.filledBlanks)) return null;

    const expectedAnswers = Array.isArray(question.settings?.correctAnswers)
      ? question.settings.correctAnswers.filter((value): value is string => typeof value === 'string')
      : [];
    if (expectedAnswers.length === 0 || parsed.filledBlanks.length !== expectedAnswers.length) return null;

    return { type: 'WORD_BANK', filledBlanks: parsed.filledBlanks };
  }
};

const FILE_UPLOAD_CODEC: AnswerCodec<FileUploadAnswerData> = {
  type: 'FILE_UPLOAD',
  toApiPayload(data, questionId) {
    const obj = {
      assetId: data.assetId,
      fileKey: data.fileKey,
      fileName: data.fileName,
      mimeType: data.mimeType,
      size: data.size
    };
    return { questionId, answer: JSON.stringify(obj) };
  },
  fromApiPayload(payload) {
    if (!payload.answer) return null;

    const parsed = parseJsonRecord(payload.answer);
    if (!parsed || (parsed.type !== undefined && parsed.type !== 'FILE_UPLOAD')) return null;
    if (
      typeof parsed.assetId !== 'string' ||
      parsed.assetId.trim().length === 0 ||
      parsed.assetId.length > MAX_FILE_KEY_LENGTH
    ) {
      return null;
    }
    if (
      typeof parsed.fileKey !== 'string' ||
      parsed.fileKey.trim().length === 0 ||
      parsed.fileKey.length > MAX_FILE_KEY_LENGTH
    ) {
      return null;
    }
    if (
      typeof parsed.fileName !== 'string' ||
      parsed.fileName.trim().length === 0 ||
      parsed.fileName.length > MAX_FILE_NAME_LENGTH
    ) {
      return null;
    }
    if (
      typeof parsed.mimeType !== 'string' ||
      parsed.mimeType.trim().length === 0 ||
      parsed.mimeType.length > MAX_MIME_TYPE_LENGTH
    ) {
      return null;
    }
    if (typeof parsed.size !== 'number' || !Number.isSafeInteger(parsed.size) || parsed.size <= 0) {
      return null;
    }

    return {
      type: 'FILE_UPLOAD',
      assetId: parsed.assetId,
      fileKey: parsed.fileKey,
      fileName: parsed.fileName,
      mimeType: parsed.mimeType,
      size: parsed.size
    };
  }
};

const MATCHING_CODEC: AnswerCodec<MatchingAnswerData> = {
  type: 'MATCHING',
  toApiPayload(data, questionId) {
    return { questionId, answer: JSON.stringify({ type: 'MATCHING', value: data.pairs }) };
  },
  fromApiPayload(payload) {
    if (!payload.answer) return null;

    const parsed = parseJsonRecord(payload.answer);
    if (parsed?.type !== 'MATCHING') return null;

    const pairs = readMatchingPairs(parsed.value);
    return pairs ? { type: 'MATCHING', pairs } : null;
  }
};

const ORDERING_CODEC: AnswerCodec<OrderingAnswerData> = {
  type: 'ORDERING',
  toApiPayload(data, questionId) {
    return { questionId, answer: JSON.stringify({ type: 'ORDERING', value: data.orderedValues }) };
  },
  fromApiPayload(payload, question) {
    if (!payload.answer) return null;

    const parsed = parseJsonRecord(payload.answer);
    if (parsed?.type !== 'ORDERING' || !isStringArray(parsed.value)) return null;

    const orderedValues = parsed.value.map((value) => value.trim());
    const expectedValues = getOrderingAnswerValues(question);
    if (!isExactStringPermutation(orderedValues, expectedValues)) return null;

    return { type: 'ORDERING', orderedValues };
  }
};

const LINK_CODEC: AnswerCodec<LinkAnswerData> = {
  type: 'LINK',
  toApiPayload(data, questionId) {
    return { questionId, answer: JSON.stringify({ type: 'LINK', links: data.urls }) };
  },
  fromApiPayload(payload) {
    if (!payload.answer) return null;

    const parsed = parseJsonRecord(payload.answer);
    if (parsed?.type !== 'LINK' || !isStringArray(parsed.links)) return null;

    const urls = parsed.links.map((value) => value.trim()).filter(Boolean);
    if (urls.some((url) => url.length > MAX_URL_LENGTH)) return null;
    return urls.length > 0 && urls.every(isHttpUrl) ? { type: 'LINK', urls } : null;
  }
};

const HOTSPOT_CODEC: AnswerCodec<HotspotAnswerData> = {
  type: 'HOTSPOT',
  toApiPayload(data, questionId) {
    return { questionId, answer: JSON.stringify({ type: 'HOTSPOT', value: data.coordinates }) };
  },
  fromApiPayload(payload) {
    if (!payload.answer) return null;

    const parsed = parseJsonRecord(payload.answer);
    if (parsed?.type !== 'HOTSPOT') return null;

    const coordinates = readCoordinates(parsed.value);
    return coordinates ? { type: 'HOTSPOT', coordinates } : null;
  }
};

const STAR_CODEC: AnswerCodec<StarAnswerData> = {
  type: 'STAR',
  toApiPayload(data, questionId) {
    return { questionId, answer: JSON.stringify({ type: 'STAR', value: data.value }) };
  },
  fromApiPayload(payload, question) {
    if (!payload.answer) return null;

    const parsed = parseJsonRecord(payload.answer);
    if (parsed?.type !== 'STAR') return null;

    const maxStars = getStarRatingMaxFromSettings(question.settings);
    if (!isValidStarRatingValue(parsed.value, maxStars)) return null;

    return { type: 'STAR', value: parsed.value };
  }
};

function isVideoRecordingAnswer(value: unknown): value is Omit<VideoRecordingAnswerData, 'type'> & { type?: string } {
  if (!isRecord(value)) return false;

  const data = value as Partial<VideoRecordingAnswerData>;
  return (
    typeof data.assetId === 'string' &&
    data.assetId.trim().length > 0 &&
    data.assetId.length <= MAX_FILE_KEY_LENGTH &&
    typeof data.storageKey === 'string' &&
    data.storageKey.trim().length > 0 &&
    data.storageKey.length <= MAX_FILE_KEY_LENGTH &&
    typeof data.fileName === 'string' &&
    data.fileName.trim().length > 0 &&
    data.fileName.length <= MAX_FILE_NAME_LENGTH &&
    typeof data.mimeType === 'string' &&
    data.mimeType.startsWith('video/') &&
    data.mimeType.length <= MAX_MIME_TYPE_LENGTH &&
    typeof data.size === 'number' &&
    Number.isSafeInteger(data.size) &&
    data.size > 0 &&
    typeof data.durationSeconds === 'number' &&
    Number.isFinite(data.durationSeconds) &&
    data.durationSeconds > 0 &&
    typeof data.recordedAt === 'string' &&
    Number.isFinite(Date.parse(data.recordedAt)) &&
    typeof data.uploadedAt === 'string' &&
    Number.isFinite(Date.parse(data.uploadedAt)) &&
    data.provider === 'cloudflare' &&
    (data.retakeCount === undefined || (Number.isSafeInteger(data.retakeCount) && data.retakeCount >= 0))
  );
}

const VIDEO_RECORDING_CODEC: AnswerCodec<VideoRecordingAnswerData> = {
  type: 'VIDEO_RECORDING',
  toApiPayload(data, questionId) {
    const { playbackUrl: _playbackUrl, ...answerData } = data;
    return { questionId, answer: JSON.stringify(answerData) };
  },
  fromApiPayload(payload) {
    if (!payload.answer) return null;

    const parsed = parseJsonRecord(payload.answer);
    if (parsed?.type !== 'VIDEO_RECORDING' || !isVideoRecordingAnswer(parsed)) return null;

    return {
      type: 'VIDEO_RECORDING',
      assetId: parsed.assetId,
      storageKey: parsed.storageKey,
      fileName: parsed.fileName,
      mimeType: parsed.mimeType,
      size: parsed.size,
      durationSeconds: parsed.durationSeconds,
      recordedAt: parsed.recordedAt,
      uploadedAt: parsed.uploadedAt,
      provider: 'cloudflare',
      retakeCount: typeof parsed.retakeCount === 'number' ? parsed.retakeCount : undefined
    };
  }
};

/**
 * ASSESSMENT_ITEM answers never travel the legacy flat payload; they use the
 * assessment response envelope, which is not wired up yet. Any legacy
 * payload for this type is explicitly rejected — no fallback, no coercion.
 */
const ASSESSMENT_ITEM_REJECT_CODEC: AnswerCodec = {
  type: QUESTION_TYPE_KEY.ASSESSMENT_ITEM,
  toApiPayload(_data, questionId) {
    return { questionId };
  },
  fromApiPayload() {
    return null;
  }
};

export const ANSWER_CODECS: Record<QuestionTypeKey, AnswerCodec> = {
  [QUESTION_TYPE_KEY.RADIO]: RADIO_CODEC,
  [QUESTION_TYPE_KEY.CHECKBOX]: CHECKBOX_CODEC,
  [QUESTION_TYPE_KEY.TRUE_FALSE]: TRUE_FALSE_CODEC,
  [QUESTION_TYPE_KEY.THUMBS]: THUMBS_CODEC,
  [QUESTION_TYPE_KEY.TEXTAREA]: TEXTAREA_CODEC,
  [QUESTION_TYPE_KEY.SHORT_ANSWER]: SHORT_ANSWER_CODEC,
  [QUESTION_TYPE_KEY.NUMERIC]: NUMERIC_CODEC,
  [QUESTION_TYPE_KEY.FILL_BLANK]: FILL_BLANK_CODEC,
  [QUESTION_TYPE_KEY.WORD_BANK]: WORD_BANK_CODEC,
  [QUESTION_TYPE_KEY.FILE_UPLOAD]: FILE_UPLOAD_CODEC,
  [QUESTION_TYPE_KEY.MATCHING]: MATCHING_CODEC,
  [QUESTION_TYPE_KEY.ORDERING]: ORDERING_CODEC,
  [QUESTION_TYPE_KEY.LINK]: LINK_CODEC,
  [QUESTION_TYPE_KEY.HOTSPOT]: HOTSPOT_CODEC,
  [QUESTION_TYPE_KEY.STAR]: STAR_CODEC,
  [QUESTION_TYPE_KEY.VIDEO_RECORDING]: VIDEO_RECORDING_CODEC,
  [QUESTION_TYPE_KEY.ASSESSMENT_ITEM]: ASSESSMENT_ITEM_REJECT_CODEC
};

/** Convert any answer to API submission payload */
export function toApiPayload(data: AnswerData, questionId: number): ApiPayload {
  switch (data.type) {
    case QUESTION_TYPE_KEY.RADIO:
      return RADIO_CODEC.toApiPayload(data, questionId);
    case QUESTION_TYPE_KEY.CHECKBOX:
      return CHECKBOX_CODEC.toApiPayload(data, questionId);
    case QUESTION_TYPE_KEY.TRUE_FALSE:
      return TRUE_FALSE_CODEC.toApiPayload(data, questionId);
    case QUESTION_TYPE_KEY.THUMBS:
      return THUMBS_CODEC.toApiPayload(data, questionId);
    case QUESTION_TYPE_KEY.TEXTAREA:
      return TEXTAREA_CODEC.toApiPayload(data, questionId);
    case QUESTION_TYPE_KEY.SHORT_ANSWER:
      return SHORT_ANSWER_CODEC.toApiPayload(data, questionId);
    case QUESTION_TYPE_KEY.NUMERIC:
      return NUMERIC_CODEC.toApiPayload(data, questionId);
    case QUESTION_TYPE_KEY.FILL_BLANK:
      return FILL_BLANK_CODEC.toApiPayload(data, questionId);
    case QUESTION_TYPE_KEY.WORD_BANK:
      return WORD_BANK_CODEC.toApiPayload(data, questionId);
    case QUESTION_TYPE_KEY.FILE_UPLOAD:
      return FILE_UPLOAD_CODEC.toApiPayload(data, questionId);
    case QUESTION_TYPE_KEY.MATCHING:
      return MATCHING_CODEC.toApiPayload(data, questionId);
    case QUESTION_TYPE_KEY.ORDERING:
      return ORDERING_CODEC.toApiPayload(data, questionId);
    case QUESTION_TYPE_KEY.LINK:
      return LINK_CODEC.toApiPayload(data, questionId);
    case QUESTION_TYPE_KEY.HOTSPOT:
      return HOTSPOT_CODEC.toApiPayload(data, questionId);
    case QUESTION_TYPE_KEY.STAR:
      return STAR_CODEC.toApiPayload(data, questionId);
    case QUESTION_TYPE_KEY.VIDEO_RECORDING:
      return VIDEO_RECORDING_CODEC.toApiPayload(data, questionId);
    case QUESTION_TYPE_KEY.ASSESSMENT_ITEM:
      return ASSESSMENT_ITEM_REJECT_CODEC.toApiPayload(data, questionId);
  }
}

function isPayloadMissing(questionTypeKey: QuestionTypeKey, payload: ApiPayload): boolean {
  return questionTypeKey === QUESTION_TYPE_KEY.RADIO ? payload.optionId === undefined : payload.answer === undefined;
}

export function decodeApiPayload(
  questionTypeKey: QuestionTypeKey,
  payload: ApiPayload,
  question: ExerciseQuestionModel
): AnswerDecodeResult {
  if (isPayloadMissing(questionTypeKey, payload)) {
    return { success: false, reason: 'missing', message: 'Answer payload is missing' };
  }

  const answerData = ANSWER_CODECS[questionTypeKey].fromApiPayload(payload, question);
  if (!answerData) {
    return { success: false, reason: 'invalid', message: `Invalid ${questionTypeKey} answer payload` };
  }

  return { success: true, data: answerData };
}

/** Convert API payload to AnswerData (for API write path) */
export function fromApiPayload(
  questionTypeKey: QuestionTypeKey,
  payload: ApiPayload,
  question: ExerciseQuestionModel
): AnswerData | null {
  const result = decodeApiPayload(questionTypeKey, payload, question);
  return result.success ? result.data : null;
}

export function decodeStoredAnswerData(value: unknown, question: ExerciseQuestionModel): AnswerData | null {
  if (!isRecord(value) || value.type !== question.questionType) return null;

  const questionId = Number(question.id);
  if (!Number.isSafeInteger(questionId)) return null;

  let payload: ApiPayload;
  switch (question.questionType) {
    // Stored composite answers are envelope-based; the legacy decode path
    // rejects them until the canonical read path is wired.
    case QUESTION_TYPE_KEY.ASSESSMENT_ITEM:
      return null;
    case QUESTION_TYPE_KEY.RADIO:
      payload = {
        questionId,
        optionId: typeof value.optionId === 'number' ? value.optionId : undefined
      };
      break;
    case QUESTION_TYPE_KEY.TRUE_FALSE:
    case QUESTION_TYPE_KEY.THUMBS:
      payload = {
        questionId,
        answer: typeof value.value === 'boolean' ? String(value.value) : undefined
      };
      break;
    case QUESTION_TYPE_KEY.TEXTAREA:
    case QUESTION_TYPE_KEY.SHORT_ANSWER:
      payload = {
        questionId,
        answer: typeof value.text === 'string' ? value.text : undefined
      };
      break;
    case QUESTION_TYPE_KEY.FILL_BLANK:
      payload = {
        questionId,
        answer: JSON.stringify({ type: QUESTION_TYPE_KEY.FILL_BLANK, answers: value.values })
      };
      break;
    case QUESTION_TYPE_KEY.MATCHING:
      payload = {
        questionId,
        answer: JSON.stringify({ type: QUESTION_TYPE_KEY.MATCHING, value: value.pairs })
      };
      break;
    case QUESTION_TYPE_KEY.ORDERING:
      payload = {
        questionId,
        answer: JSON.stringify({ type: QUESTION_TYPE_KEY.ORDERING, value: value.orderedValues })
      };
      break;
    case QUESTION_TYPE_KEY.LINK:
      payload = {
        questionId,
        answer: JSON.stringify({ type: QUESTION_TYPE_KEY.LINK, links: value.urls })
      };
      break;
    case QUESTION_TYPE_KEY.HOTSPOT:
      payload = {
        questionId,
        answer: JSON.stringify({ type: QUESTION_TYPE_KEY.HOTSPOT, value: value.coordinates })
      };
      break;
    case QUESTION_TYPE_KEY.CHECKBOX:
    case QUESTION_TYPE_KEY.NUMERIC:
    case QUESTION_TYPE_KEY.WORD_BANK:
    case QUESTION_TYPE_KEY.FILE_UPLOAD:
    case QUESTION_TYPE_KEY.STAR:
    case QUESTION_TYPE_KEY.VIDEO_RECORDING:
      payload = { questionId, answer: JSON.stringify(value) };
      break;
  }

  return fromApiPayload(question.questionType, payload, question);
}

/**
 * Extract display values from AnswerData for charts/summary display.
 * Returns selectedIds/selectedValues for option-based types, text for text types.
 */
export function extractAnswerDisplayValues(data: AnswerData): {
  selectedIds: string[];
  selectedValues: unknown[];
  text?: string;
} {
  switch (data.type) {
    case 'RADIO':
      return {
        selectedIds: [String(data.optionId)],
        selectedValues: [data.optionId]
      };
    case 'CHECKBOX':
      return {
        selectedIds: data.optionIds.map(String),
        selectedValues: data.optionIds
      };
    case 'TRUE_FALSE':
    case 'THUMBS':
      return {
        selectedIds: [String(data.value)],
        selectedValues: [data.value]
      };
    case 'TEXTAREA':
    case 'SHORT_ANSWER':
      return { selectedIds: [], selectedValues: [], text: data.text };
    case 'NUMERIC':
      return { selectedIds: [], selectedValues: [], text: String(data.value) };
    case 'STAR':
      return { selectedIds: [], selectedValues: [data.value], text: String(data.value) };
    case 'FILL_BLANK':
      return { selectedIds: [], selectedValues: [], text: data.values.join(', ') };
    case 'WORD_BANK':
      return { selectedIds: [], selectedValues: [], text: data.filledBlanks.filter(Boolean).join(', ') };
    case 'LINK':
      return { selectedIds: [], selectedValues: data.urls, text: data.urls.join(', ') };
    case 'MATCHING':
    case 'ORDERING':
    case 'HOTSPOT':
    case 'FILE_UPLOAD':
    case 'VIDEO_RECORDING':
      return { selectedIds: [], selectedValues: [] };
    default:
      return { selectedIds: [], selectedValues: [] };
  }
}
