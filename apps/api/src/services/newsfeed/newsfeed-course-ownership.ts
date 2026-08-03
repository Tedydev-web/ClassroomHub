import { getNewsfeedById, getNewsfeedCommentAuthorAndCourse } from '@cio/db/queries/newsfeed';

import { AppError, ErrorCodes } from '@api/utils/errors';

export async function assertNewsfeedBelongsToCourse(courseId: string, feedId: string): Promise<void> {
  const feed = await getNewsfeedById(feedId);

  if (!feed || feed.courseId !== courseId) {
    throw new AppError('Newsfeed item not found', ErrorCodes.NOT_FOUND, 404);
  }
}

export async function assertNewsfeedCommentBelongsToCourse(courseId: string, commentId: number): Promise<void> {
  const comment = await getNewsfeedCommentAuthorAndCourse(commentId);

  if (!comment || comment.courseId !== courseId) {
    throw new AppError('Comment not found', ErrorCodes.COMMENT_NOT_FOUND, 404);
  }
}
