/**
 * What a teacher is supposed to do about a finding.
 *
 * `blocking` says whether a draft may be published. It says nothing about who has to act,
 * and three unrelated situations were arriving as one flat red list: a paper that simply
 * has no answer key, a paper whose own text is faulty, and a shape the importer could not
 * read. Forty identical "no answer key" rows buried the one finding that needed a human,
 * and the control that would have fixed all forty sat behind a collapsed panel.
 *
 * The class is derived from the code rather than stored on the diagnostic. It is a
 * property of the kind of finding, not of one occurrence, so deriving it keeps drafts
 * written before this existed classified exactly like drafts written after — and there is
 * no second copy to drift.
 */
export type ExamImportFindingClass =
  /** The document does not contain something the exam needs. The teacher supplies it. */
  | 'input_missing'
  /** The importer read the document correctly and the document is wrong. The teacher edits it. */
  | 'source_defect'
  /** The importer could not make sense of the source. The teacher checks it, or AI repairs it. */
  | 'extraction_uncertain';

const INPUT_MISSING = new Set([
  'ANSWER_KEY_MISSING',
  'MISSING_ANSWER_KEY',
  'ANSWER_KEY_COUNT_MISMATCH',
  'POINTS_PARTIALLY_SPECIFIED'
]);

const SOURCE_DEFECT = new Set([
  'ANSWER_CONFLICT_REQUIRES_CONFIRMATION',
  'ANSWER_SOURCE_CONFLICT',
  'ANSWER_SOURCE_CONFLICT_UNRESOLVED',
  'DUPLICATE_ACCEPTED_ANSWER',
  'DUPLICATE_OPTION_LABEL',
  'DUPLICATE_OPTION_SOURCE_LABEL',
  'DUPLICATE_OPTION_TEXT',
  'EMPTY_OPTION_CONTENT',
  'EMPTY_QUESTION_PROMPT',
  'EMPTY_SHARED_CONTENT',
  'EMPTY_STATEMENT_CONTENT',
  'OPTION_SET_INCOMPLETE',
  'PLACEHOLDER_QUESTION_PROMPT',
  'SECTION_QUESTION_RANGE_MISMATCH'
]);

/**
 * Anything unlisted is uncertainty, deliberately. An unknown code means the importer met
 * something it has no name for, and telling a teacher their document is at fault on that
 * basis would be a guess dressed as a verdict. Internal invariant failures land here too:
 * "this could not be read" is honest about a corrupt draft as well.
 */
export function examImportFindingClass(code: string): ExamImportFindingClass {
  if (INPUT_MISSING.has(code)) return 'input_missing';
  if (SOURCE_DEFECT.has(code)) return 'source_defect';

  return 'extraction_uncertain';
}
