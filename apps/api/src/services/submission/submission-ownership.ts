import { AppError, ErrorCodes } from '@api/utils/errors';
import { getSubmissionById, lockCourseSubmission } from '@cio/db/queries/submission';
import type { DbOrTxClient } from '@cio/db/drizzle';
import type { TSubmission } from '@cio/db/types';

export async function getCourseSubmissionOrThrow(courseId: string, submissionId: string): Promise<TSubmission> {
  const submission = await getSubmissionById(submissionId);
  if (!submission || submission.courseId !== courseId) {
    throw new AppError('Submission not found', ErrorCodes.SUBMISSION_NOT_FOUND, 404);
  }

  return submission;
}

export async function lockCourseSubmissionOrThrow(
  courseId: string,
  submissionId: string,
  dbClient: DbOrTxClient
): Promise<TSubmission> {
  const submission = await lockCourseSubmission(courseId, submissionId, dbClient);
  if (!submission) {
    throw new AppError('Submission not found', ErrorCodes.SUBMISSION_NOT_FOUND, 404);
  }

  return submission;
}
