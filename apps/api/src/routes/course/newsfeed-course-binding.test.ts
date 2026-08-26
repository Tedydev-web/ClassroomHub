import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertNewsfeedBelongsToCourse: vi.fn(),
  assertNewsfeedCommentBelongsToCourse: vi.fn(),
  createNewsfeedCommentService: vi.fn(),
  deleteNewsfeedService: vi.fn(),
  deleteNewsfeedCommentService: vi.fn(),
  getNewsfeedCommentThreadService: vi.fn(),
  getNewsfeedItem: vi.fn(),
  getGroupMemberIdByCourseAndProfile: vi.fn(),
  updateNewsfeedReactionService: vi.fn(),
  updateNewsfeedService: vi.fn(),
  updateNewsfeedCommentService: vi.fn()
}));

vi.mock('@api/middlewares/auth', () => ({
  authMiddleware: async (c: { set: (key: string, value: unknown) => void }, next: () => Promise<unknown>) => {
    c.set('user', { id: 'member-a' });
    return next();
  }
}));
vi.mock('@api/middlewares/course-member', () => ({
  courseMemberMiddleware: (_c: unknown, next: () => Promise<unknown>) => next()
}));
vi.mock('@api/middlewares/course-team-member', () => ({
  courseTeamMemberMiddleware: (_c: unknown, next: () => Promise<unknown>) => next()
}));
vi.mock('@api/middlewares/newsfeed-comment-author-only', () => ({
  newsfeedCommentAuthorOnlyMiddleware: (_c: unknown, next: () => Promise<unknown>) => next()
}));
vi.mock('@api/middlewares/newsfeed-comment-author-or-team', () => ({
  newsfeedCommentAuthorOrTeamMiddleware: (_c: unknown, next: () => Promise<unknown>) => next()
}));
vi.mock('@api/services/newsfeed/newsfeed-course-ownership', () => ({
  assertNewsfeedBelongsToCourse: mocks.assertNewsfeedBelongsToCourse,
  assertNewsfeedCommentBelongsToCourse: mocks.assertNewsfeedCommentBelongsToCourse
}));
vi.mock('@api/services/newsfeed', () => ({
  createNewsfeedCommentService: mocks.createNewsfeedCommentService,
  createNewsfeedService: vi.fn(),
  deleteNewsfeedCommentService: mocks.deleteNewsfeedCommentService,
  deleteNewsfeedService: mocks.deleteNewsfeedService,
  getNewsfeedCommentThreadService: mocks.getNewsfeedCommentThreadService,
  getNewsfeedItem: mocks.getNewsfeedItem,
  listNewsfeedPaginated: vi.fn(),
  updateNewsfeedCommentService: mocks.updateNewsfeedCommentService,
  updateNewsfeedReactionService: mocks.updateNewsfeedReactionService,
  updateNewsfeedService: mocks.updateNewsfeedService
}));
vi.mock('@cio/db/queries/group', () => ({
  getGroupMemberIdByCourseAndProfile: mocks.getGroupMemberIdByCourseAndProfile
}));

import { AppError, ErrorCodes } from '@api/utils/errors';
import { newsfeedRouter } from './newsfeed';
import { Hono } from '@api/utils/hono';

const app = new Hono().route('/courses/:courseId/newsfeed', newsfeedRouter);

type Operation = {
  name: string;
  request: Request;
  downstream: () => unknown;
  ownershipCheck: () => unknown;
  successStatus: number;
};

const feedId = 'feed-b';

function operations(): Operation[] {
  return [
    {
      name: 'read feed',
      request: new Request(`http://test/courses/course-a/newsfeed/${feedId}`),
      downstream: () => mocks.getNewsfeedItem,
      ownershipCheck: () => mocks.assertNewsfeedBelongsToCourse,
      successStatus: 200
    },
    {
      name: 'update feed',
      request: new Request(`http://test/courses/course-a/newsfeed/${feedId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'Updated feed' })
      }),
      downstream: () => mocks.updateNewsfeedService,
      ownershipCheck: () => mocks.assertNewsfeedBelongsToCourse,
      successStatus: 200
    },
    {
      name: 'react to feed',
      request: new Request(`http://test/courses/course-a/newsfeed/${feedId}/react`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reaction: { clap: [], smile: [], thumbsup: [], thumbsdown: [] } })
      }),
      downstream: () => mocks.updateNewsfeedReactionService,
      ownershipCheck: () => mocks.assertNewsfeedBelongsToCourse,
      successStatus: 200
    },
    {
      name: 'delete feed',
      request: new Request(`http://test/courses/course-a/newsfeed/${feedId}`, { method: 'DELETE' }),
      downstream: () => mocks.deleteNewsfeedService,
      ownershipCheck: () => mocks.assertNewsfeedBelongsToCourse,
      successStatus: 200
    },
    {
      name: 'read comments',
      request: new Request(`http://test/courses/course-a/newsfeed/${feedId}/comments`),
      downstream: () => mocks.getNewsfeedCommentThreadService,
      ownershipCheck: () => mocks.assertNewsfeedBelongsToCourse,
      successStatus: 200
    },
    {
      name: 'create a comment',
      request: new Request(`http://test/courses/course-a/newsfeed/${feedId}/comment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ courseNewsfeedId: feedId, content: 'Comment' })
      }),
      downstream: () => mocks.createNewsfeedCommentService,
      ownershipCheck: () => mocks.assertNewsfeedBelongsToCourse,
      successStatus: 201
    },
    {
      name: 'reply to a comment',
      request: new Request(`http://test/courses/course-a/newsfeed/${feedId}/comment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ courseNewsfeedId: feedId, content: 'Reply', parentId: 1, replyToCommentId: 1 })
      }),
      downstream: () => mocks.createNewsfeedCommentService,
      ownershipCheck: () => mocks.assertNewsfeedBelongsToCourse,
      successStatus: 201
    },
    {
      name: 'update a comment',
      request: new Request('http://test/courses/course-a/newsfeed/comment/1', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'Updated comment' })
      }),
      downstream: () => mocks.updateNewsfeedCommentService,
      ownershipCheck: () => mocks.assertNewsfeedCommentBelongsToCourse,
      successStatus: 200
    },
    {
      name: 'delete a comment',
      request: new Request('http://test/courses/course-a/newsfeed/comment/1', { method: 'DELETE' }),
      downstream: () => mocks.deleteNewsfeedCommentService,
      ownershipCheck: () => mocks.assertNewsfeedCommentBelongsToCourse,
      successStatus: 200
    }
  ];
}

describe('newsfeed course binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertNewsfeedBelongsToCourse.mockResolvedValue(undefined);
    mocks.assertNewsfeedCommentBelongsToCourse.mockResolvedValue(undefined);
    mocks.createNewsfeedCommentService.mockResolvedValue({ id: 1 });
    mocks.deleteNewsfeedCommentService.mockResolvedValue({ id: 1 });
    mocks.deleteNewsfeedService.mockResolvedValue({ id: feedId });
    mocks.getGroupMemberIdByCourseAndProfile.mockResolvedValue('member-a');
    mocks.getNewsfeedCommentThreadService.mockResolvedValue({ items: [] });
    mocks.getNewsfeedItem.mockResolvedValue({ id: feedId });
    mocks.updateNewsfeedReactionService.mockResolvedValue({ id: feedId });
    mocks.updateNewsfeedService.mockResolvedValue({ id: feedId });
    mocks.updateNewsfeedCommentService.mockResolvedValue({ id: 1 });
  });

  it.each(operations())('rejects a course A member attempting to $name a course B resource', async (operation) => {
    const foreignCourseError = new AppError('Newsfeed item not found', ErrorCodes.NOT_FOUND, 404);
    mocks.assertNewsfeedBelongsToCourse.mockRejectedValue(foreignCourseError);
    mocks.assertNewsfeedCommentBelongsToCourse.mockRejectedValue(foreignCourseError);

    const response = await app.fetch(operation.request);

    expect(response.status).toBe(404);
    expect(operation.ownershipCheck()).toHaveBeenCalled();
    expect(operation.downstream()).not.toHaveBeenCalled();
  });

  it.each(operations())('allows the same-course $name operation', async (operation) => {
    const response = await app.fetch(operation.request);

    expect(response.status).toBe(operation.successStatus);
    expect(operation.ownershipCheck()).toHaveBeenCalled();
    expect(operation.downstream()).toHaveBeenCalled();
  });
});
