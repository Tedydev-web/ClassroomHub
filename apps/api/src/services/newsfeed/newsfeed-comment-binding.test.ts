import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createNewsfeedComment: vi.fn(),
  getNewsfeedById: vi.fn(),
  getNewsfeedCommentById: vi.fn(),
  getNewsfeedCommentsByFeedIdPaginated: vi.fn(),
  getNewsfeedForEmail: vi.fn()
}));

vi.mock('@cio/db/queries/newsfeed', () => ({
  createNewsfeedComment: mocks.createNewsfeedComment,
  getNewsfeedById: mocks.getNewsfeedById,
  getNewsfeedCommentById: mocks.getNewsfeedCommentById,
  getNewsfeedCommentsByFeedIdPaginated: mocks.getNewsfeedCommentsByFeedIdPaginated,
  getNewsfeedForEmail: mocks.getNewsfeedForEmail
}));
vi.mock('@cio/core/utils/sanitize-html', () => ({ sanitizeHtml: (content: string) => content }));
vi.mock('@api/services/jobs', () => ({ enqueueTransactionalEmail: vi.fn() }));
vi.mock('@api/services/webhook', () => ({ emitWebhookEvent: vi.fn() }));
vi.mock('@cio/db/queries/notifications', () => ({ createNotification: vi.fn(), createNotifications: vi.fn() }));

import { ErrorCodes } from '@api/utils/errors';
import { createNewsfeedCommentService, getNewsfeedCommentsService } from './newsfeed';

const feedId = 'feed-a';
const foreignFeedId = 'feed-b';

function comment(id: number, courseNewsfeedId: string, parentId: number | null) {
  return { id, courseNewsfeedId, parentId };
}

function expectCommentNotFound(promise: Promise<unknown>) {
  return expect(promise).rejects.toMatchObject({ code: ErrorCodes.COMMENT_NOT_FOUND, statusCode: 404 });
}

describe('newsfeed comment feed binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createNewsfeedComment.mockResolvedValue({ id: 99 });
    mocks.getNewsfeedById.mockResolvedValue({ id: feedId });
    mocks.getNewsfeedCommentsByFeedIdPaginated.mockResolvedValue({ items: [] });
  });

  it('rejects reply fetches with a missing parent before pagination', async () => {
    mocks.getNewsfeedCommentById.mockResolvedValue(null);

    await expectCommentNotFound(getNewsfeedCommentsService(feedId, { parentId: 1, limit: 5 }));

    expect(mocks.getNewsfeedCommentsByFeedIdPaginated).not.toHaveBeenCalled();
  });

  it('rejects reply fetches with a foreign-feed parent before pagination', async () => {
    mocks.getNewsfeedCommentById.mockResolvedValue(comment(1, foreignFeedId, null));

    await expectCommentNotFound(getNewsfeedCommentsService(feedId, { parentId: 1, limit: 5 }));

    expect(mocks.getNewsfeedCommentsByFeedIdPaginated).not.toHaveBeenCalled();
  });

  it('fetches replies for a parent in the requested feed', async () => {
    mocks.getNewsfeedCommentById.mockResolvedValue(comment(1, feedId, null));

    await expect(getNewsfeedCommentsService(feedId, { parentId: 1, limit: 5 })).resolves.toEqual({ items: [] });

    expect(mocks.getNewsfeedCommentsByFeedIdPaginated).toHaveBeenCalledWith(feedId, { parentId: 1, limit: 5 });
  });

  it('rejects replies with a foreign parent before insert', async () => {
    mocks.getNewsfeedCommentById.mockResolvedValue(comment(1, foreignFeedId, null));

    await expectCommentNotFound(createNewsfeedCommentService(feedId, 'author-a', 'Reply', 1));

    expect(mocks.createNewsfeedComment).not.toHaveBeenCalled();
  });

  it('rejects replies with a foreign reply target before insert', async () => {
    mocks.getNewsfeedCommentById
      .mockResolvedValueOnce(comment(1, feedId, null))
      .mockResolvedValueOnce(comment(2, foreignFeedId, 1));

    await expectCommentNotFound(createNewsfeedCommentService(feedId, 'author-a', 'Reply', 1, 2));

    expect(mocks.createNewsfeedComment).not.toHaveBeenCalled();
  });

  it('creates replies for a same-feed top-level parent and same-thread target', async () => {
    mocks.getNewsfeedCommentById
      .mockResolvedValueOnce(comment(1, feedId, null))
      .mockResolvedValueOnce(comment(2, feedId, 1));

    await expect(createNewsfeedCommentService(feedId, 'author-a', 'Reply', 1, 2)).resolves.toEqual({ id: 99 });

    expect(mocks.createNewsfeedComment).toHaveBeenCalledWith({
      authorId: 'author-a',
      content: 'Reply',
      courseNewsfeedId: feedId,
      parentId: 1,
      replyToCommentId: 2
    });
  });

  it('rejects a same-feed reply target from another thread before insert', async () => {
    mocks.getNewsfeedCommentById
      .mockResolvedValueOnce(comment(1, feedId, null))
      .mockResolvedValueOnce(comment(2, feedId, 3));

    await expect(createNewsfeedCommentService(feedId, 'author-a', 'Reply', 1, 2)).rejects.toMatchObject({
      code: ErrorCodes.VALIDATION_ERROR,
      statusCode: 400
    });

    expect(mocks.createNewsfeedComment).not.toHaveBeenCalled();
  });
});
