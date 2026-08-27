import { describe, expect, it } from 'vitest';
import { examImportFindingClass } from '../src/draft/exam-import-finding-class';

/**
 * The class answers the only question a teacher has about a finding: what do I do?
 * It is derived from the code rather than stored, so a draft written before the
 * classification existed is classified the same way as one written after.
 */
describe('finding class', () => {
  it('calls a missing answer key an unfinished input, not an error', () => {
    expect(examImportFindingClass('ANSWER_KEY_MISSING')).toBe('input_missing');
    expect(examImportFindingClass('MISSING_ANSWER_KEY')).toBe('input_missing');
    expect(examImportFindingClass('ANSWER_KEY_COUNT_MISMATCH')).toBe('input_missing');
  });

  it('calls a fault in the document a source defect', () => {
    expect(examImportFindingClass('DUPLICATE_OPTION_TEXT')).toBe('source_defect');
    expect(examImportFindingClass('SECTION_QUESTION_RANGE_MISMATCH')).toBe('source_defect');
    expect(examImportFindingClass('EMPTY_QUESTION_PROMPT')).toBe('source_defect');
    expect(examImportFindingClass('ANSWER_SOURCE_CONFLICT')).toBe('source_defect');
  });

  it('calls a shape it could not read extraction uncertainty', () => {
    expect(examImportFindingClass('QUESTION_STRUCTURE_UNRESOLVED')).toBe('extraction_uncertain');
    expect(examImportFindingClass('UNRECOGNIZED_QUESTION_SHAPE')).toBe('extraction_uncertain');
    expect(examImportFindingClass('UNASSIGNED_SOURCE_CONTENT')).toBe('extraction_uncertain');
  });

  it('defaults an unknown code to uncertainty rather than blaming the document', () => {
    expect(examImportFindingClass('SOMETHING_NOBODY_HAS_WRITTEN_YET')).toBe('extraction_uncertain');
  });
});
