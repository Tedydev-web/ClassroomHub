import type * as z from 'zod';

/**
 * Stable issue codes for the assessment kernel. The kernel never throws for
 * invalid input and never maps to HTTP concerns; callers translate these
 * codes into their own error taxonomy.
 */
export const ASSESSMENT_ISSUE_CODE = {
  UNSUPPORTED_SCHEMA_VERSION: 'UNSUPPORTED_SCHEMA_VERSION',
  UNSUPPORTED_INTERACTION_KIND: 'UNSUPPORTED_INTERACTION_KIND',
  MALFORMED_DEFINITION: 'MALFORMED_DEFINITION',
  DUPLICATE_BLOCK_ID: 'DUPLICATE_BLOCK_ID',
  INVALID_SCORE: 'INVALID_SCORE',
  PUBLISH_RULE_VIOLATION: 'PUBLISH_RULE_VIOLATION',
  UNSUPPORTED_LEGACY_TYPE: 'UNSUPPORTED_LEGACY_TYPE',
  MALFORMED_RESPONSE: 'MALFORMED_RESPONSE',
  DUPLICATE_RESPONSE_ENTRY: 'DUPLICATE_RESPONSE_ENTRY',
  UNKNOWN_INTERACTION: 'UNKNOWN_INTERACTION',
  RESPONSE_KIND_MISMATCH: 'RESPONSE_KIND_MISMATCH',
  RESPONSE_CONSTRAINT: 'RESPONSE_CONSTRAINT',
  MISSING_REQUIRED_RESPONSE: 'MISSING_REQUIRED_RESPONSE'
} as const;

export type AssessmentIssueCode = (typeof ASSESSMENT_ISSUE_CODE)[keyof typeof ASSESSMENT_ISSUE_CODE];

export interface AssessmentIssue {
  code: AssessmentIssueCode;
  path: Array<string | number>;
  /** Human-readable detail. Must never contain answer keys. */
  message: string;
}

export type AssessmentResult<T> = { success: true; data: T } | { success: false; issues: AssessmentIssue[] };

export function assessmentSuccess<T>(data: T): AssessmentResult<T> {
  return { success: true, data };
}

export function assessmentFailure<T>(issues: AssessmentIssue[]): AssessmentResult<T> {
  return { success: false, issues };
}

export function assessmentIssue(
  code: AssessmentIssueCode,
  path: Array<string | number>,
  message: string
): AssessmentIssue {
  return { code, path, message };
}

/** Converts Zod issues into assessment issues, choosing the code per issue path. */
export function zodIssuesToAssessmentIssues(
  error: z.ZodError,
  resolveCode: (path: Array<string | number>) => AssessmentIssueCode
): AssessmentIssue[] {
  return error.issues.map((issue) => {
    const path = issue.path.filter(
      (segment): segment is string | number => typeof segment === 'string' || typeof segment === 'number'
    );
    return assessmentIssue(resolveCode(path), path, issue.message);
  });
}
