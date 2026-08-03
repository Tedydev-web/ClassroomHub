import { QUESTION_TYPE_KEY, type QuestionTypeKey } from './question-type-keys';
import type { QuestionTypeMetadata } from './question-type-types';

export const QUESTION_TYPE_REGISTRY: readonly QuestionTypeMetadata[] = [
  {
    key: QUESTION_TYPE_KEY.RADIO,
    typename: 'RADIO',
    label: 'Single answer',
    id: 1,
    autoGradable: true,
    supportsPartialCredit: false,
    manualGradingRequired: false
  },
  {
    key: QUESTION_TYPE_KEY.CHECKBOX,
    typename: 'CHECKBOX',
    label: 'Multiple answers',
    id: 2,
    autoGradable: true,
    supportsPartialCredit: true,
    manualGradingRequired: false
  },
  {
    key: QUESTION_TYPE_KEY.TEXTAREA,
    typename: 'TEXTAREA',
    label: 'Paragraph',
    id: 3,
    autoGradable: false,
    supportsPartialCredit: false,
    manualGradingRequired: true
  },
  {
    key: QUESTION_TYPE_KEY.TRUE_FALSE,
    typename: 'TRUE_FALSE',
    label: 'True/False',
    id: 4,
    autoGradable: true,
    supportsPartialCredit: false,
    manualGradingRequired: false
  },
  {
    key: QUESTION_TYPE_KEY.SHORT_ANSWER,
    typename: 'SHORT_ANSWER',
    label: 'Short answer',
    id: 5,
    autoGradable: false,
    supportsPartialCredit: false,
    manualGradingRequired: true
  },
  {
    key: QUESTION_TYPE_KEY.NUMERIC,
    typename: 'NUMERIC',
    label: 'Numeric answer',
    id: 6,
    autoGradable: true,
    supportsPartialCredit: true,
    manualGradingRequired: false
  },
  {
    key: QUESTION_TYPE_KEY.FILL_BLANK,
    typename: 'FILL_BLANK',
    label: 'Fill in the blank',
    id: 7,
    autoGradable: true,
    supportsPartialCredit: true,
    manualGradingRequired: false
  },
  {
    key: QUESTION_TYPE_KEY.FILE_UPLOAD,
    typename: 'FILE_UPLOAD',
    label: 'File upload',
    id: 8,
    autoGradable: false,
    supportsPartialCredit: false,
    manualGradingRequired: true
  },
  {
    key: QUESTION_TYPE_KEY.ORDERING,
    typename: 'ORDERING',
    label: 'Ordering',
    id: 9,
    autoGradable: true,
    supportsPartialCredit: true,
    manualGradingRequired: false
  },
  {
    key: QUESTION_TYPE_KEY.LINK,
    typename: 'LINK',
    label: 'Links',
    id: 10,
    autoGradable: false,
    supportsPartialCredit: false,
    manualGradingRequired: true
  },
  {
    key: QUESTION_TYPE_KEY.WORD_BANK,
    typename: 'WORD_BANK',
    label: 'Word bank',
    id: 11,
    autoGradable: true,
    supportsPartialCredit: true,
    manualGradingRequired: false
  },
  {
    key: QUESTION_TYPE_KEY.STAR,
    typename: 'STAR',
    label: 'Star rating',
    id: 12,
    autoGradable: true,
    supportsPartialCredit: false,
    manualGradingRequired: false
  },
  {
    key: QUESTION_TYPE_KEY.VIDEO_RECORDING,
    typename: 'VIDEO_RECORDING',
    label: 'Video recording',
    id: 13,
    autoGradable: false,
    supportsPartialCredit: false,
    manualGradingRequired: true
  },
  // Built but not offered in the product. Kept at the END of the id sequence
  // (append-only) so they never shift the ids of types that exist in the DB.
  // They have no `question_type` row, so `disabled` keeps them out of pickers,
  // the AI tool enum, and validation.
  {
    key: QUESTION_TYPE_KEY.MATCHING,
    typename: 'MATCHING',
    label: 'Matching',
    id: 14,
    autoGradable: true,
    supportsPartialCredit: true,
    manualGradingRequired: false,
    disabled: true
  },
  {
    key: QUESTION_TYPE_KEY.HOTSPOT,
    typename: 'HOTSPOT',
    label: 'Hotspot',
    id: 15,
    autoGradable: true,
    supportsPartialCredit: true,
    manualGradingRequired: false,
    disabled: true
  },
  // Internal composite item type. Reserved at deterministic DB id 16 (a
  // migration verifies/inserts the row explicitly; seed order is not an ID
  // contract). `internal` keeps it out of pickers, AI/MCP enums, and generic
  // exercise validation; only the advanced composer action creates it.
  // Static capability metadata is conservative — runtime capability is always
  // derived from the contained interactions of the resolved definition.
  {
    key: QUESTION_TYPE_KEY.ASSESSMENT_ITEM,
    typename: 'ASSESSMENT_ITEM',
    label: 'Composite item',
    id: 16,
    autoGradable: false,
    supportsPartialCredit: true,
    manualGradingRequired: true,
    internal: true
  },
  {
    key: QUESTION_TYPE_KEY.THUMBS,
    typename: 'THUMBS',
    label: 'Thumbs up/down',
    id: 17,
    autoGradable: false,
    supportsPartialCredit: false,
    manualGradingRequired: false
  }
] as const;

/** Types authors can select directly (excludes `disabled` and `internal` ones). */
export const ENABLED_QUESTION_TYPE_REGISTRY = QUESTION_TYPE_REGISTRY.filter((type) => !type.disabled && !type.internal);

/**
 * Types with a `question_type` database row (enabled + internal). Source of
 * truth for seed and migration identity checks; `disabled` types have no row.
 */
export const DB_BACKED_QUESTION_TYPE_REGISTRY = QUESTION_TYPE_REGISTRY.filter((type) => !type.disabled);

export const QUESTION_TYPE_BY_KEY = Object.freeze(
  QUESTION_TYPE_REGISTRY.reduce(
    (acc, type) => {
      acc[type.key] = type;
      return acc;
    },
    {} as Record<QuestionTypeKey, QuestionTypeMetadata>
  )
);

export const QUESTION_TYPE_IDS = Object.freeze(
  QUESTION_TYPE_REGISTRY.reduce(
    (acc, type) => {
      acc[type.key] = type.id;
      return acc;
    },
    {} as Record<QuestionTypeKey, number>
  )
);

export const QUESTION_TYPE_TYPENAME_TO_KEY = Object.freeze(
  QUESTION_TYPE_REGISTRY.reduce(
    (acc, type) => {
      acc[type.typename] = type.key;
      return acc;
    },
    {} as Record<string, QuestionTypeKey>
  )
);

export const QUESTION_TYPE_ID_TO_KEY = Object.freeze(
  QUESTION_TYPE_REGISTRY.reduce(
    (acc, type) => {
      acc[type.id] = type.key;
      return acc;
    },
    {} as Record<number, QuestionTypeKey>
  )
);
