import type { Context, Next } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import { AppError, ErrorCodes } from '@api/utils/errors';
import {
  assertNewsfeedBelongsToCourse,
  assertNewsfeedCommentBelongsToCourse
} from '@api/services/newsfeed/newsfeed-course-ownership';

/** Binds every comment operation to the course authorized by the parent route. */
export const newsfeedCourseBindingMiddleware = async (c: Context, next: Next) => {
  try {
    const courseId = c.req.param('courseId');
    const feedId = c.req.param('feedId');
    const commentId = c.req.param('commentId');

    if (!courseId) {
      return c.json({ success: false, error: 'Course ID is required', code: 'COURSE_ID_REQUIRED' }, 400);
    }

    if (feedId) {
      await assertNewsfeedBelongsToCourse(courseId, feedId);
      return next();
    }

    if (commentId) {
      await assertNewsfeedCommentBelongsToCourse(courseId, Number(commentId));
      return next();
    }

    return c.json({ success: false, error: 'Newsfeed or comment ID is required', code: 'NEWSFEED_ID_REQUIRED' }, 400);
  } catch (error) {
    if (error instanceof AppError) {
      return c.json(
        { success: false, error: error.message, code: error.code },
        error.statusCode as ContentfulStatusCode
      );
    }

    console.error('Error in newsfeedCourseBindingMiddleware:', error);
    return c.json(
      { success: false, error: 'Failed to verify newsfeed ownership', code: ErrorCodes.INTERNAL_ERROR },
      500
    );
  }
};
