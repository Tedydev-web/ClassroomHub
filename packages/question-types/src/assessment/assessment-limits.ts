/**
 * Size and shape limits for schema-version-1 assessment definitions and
 * response envelopes. Response payload caps reuse the legacy answer caps
 * exported from `question-answer-validation.ts` so both paths stay aligned.
 */

export const MAX_ASSESSMENT_BLOCKS = 50;
export const MAX_ASSESSMENT_INTERACTIONS = 20;
export const MAX_INTERACTION_OPTIONS = 500;
export const MAX_ASSESSMENT_ID_LENGTH = 64;
/** Block/feedback/option identifiers: 1-64 chars, alphanumeric start, then [A-Za-z0-9_-]. */
export const ASSESSMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const MAX_AUTHORED_HTML_LENGTH = 100_000;
export const MAX_INTERACTION_MAX_SCORE = 10_000;
export const MAX_ITEM_FEEDBACK_ENTRIES = 20;
export const MAX_RESPONSE_TEXT_LENGTH = 100_000;
/** Absolute star cap; mirrors the private STAR_RATING_ABSOLUTE_MAX in star-rating-settings. */
export const MAX_STAR_RATING_STARS = 10;
