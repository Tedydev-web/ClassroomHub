import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getNewsfeedById: vi.fn(),
  getNewsfeedCommentAuthorAndCourse: vi.fn()
}));

vi.mock('@cio/db/queries/newsfeed', () => ({
  getNewsfeedById: mocks.getNewsfeedById,
  getNewsfeedCommentAuthorAndCourse: mocks.getNewsfeedCommentAuthorAndCourse
}));

import { assertNewsfeedBelongsToCourse, assertNewsfeedCommentBelongsToCourse } from './newsfeed-course-ownership';

describe('newsfeed course ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a feed from another course', async () => {
    mocks.getNewsfeedById.mockResolvedValue({ courseId: 'course-b' });

    await expect(assertNewsfeedBelongsToCourse('course-a', 'feed-b')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('allows a feed from the authorized course', async () => {
    mocks.getNewsfeedById.mockResolvedValue({ courseId: 'course-a' });

    await expect(assertNewsfeedBelongsToCourse('course-a', 'feed-a')).resolves.toBeUndefined();
  });

  it('rejects a comment from another course', async () => {
    mocks.getNewsfeedCommentAuthorAndCourse.mockResolvedValue({ courseId: 'course-b' });

    await expect(assertNewsfeedCommentBelongsToCourse('course-a', 2)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('allows a comment from the authorized course', async () => {
    mocks.getNewsfeedCommentAuthorAndCourse.mockResolvedValue({ courseId: 'course-a' });

    await expect(assertNewsfeedCommentBelongsToCourse('course-a', 1)).resolves.toBeUndefined();
  });
});
