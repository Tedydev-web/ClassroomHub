import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createNewsfeedComment: vi.fn(),
  getNewsfeedById: vi.fn(),
  getNewsfeedCommentById: vi.fn(),
  getNewsfeedCommentDepth: vi.fn(),
  getNewsfeedCommentThread: vi.fn(),
  getNewsfeedForEmail: vi.fn()
}));

vi.mock('@cio/db/queries/newsfeed', () => ({
  countNewsfeedCommentDescendants: vi.fn(),
  createNewsfeedComment: mocks.createNewsfeedComment,
  getNewsfeedById: mocks.getNewsfeedById,
  getNewsfeedCommentById: mocks.getNewsfeedCommentById,
  getNewsfeedCommentDepth: mocks.getNewsfeedCommentDepth,
  getNewsfeedCommentThread: mocks.getNewsfeedCommentThread,
  getNewsfeedCommentsByFeedId: vi.fn(),
  getNewsfeedForEmail: mocks.getNewsfeedForEmail
}));
vi.mock('@cio/core/utils/sanitize-html', () => ({ sanitizeHtml: (content: string) => content }));
vi.mock('@api/services/jobs', () => ({ enqueueTransactionalEmail: vi.fn() }));
vi.mock('@cio/core/services/webhook/emit', () => ({ emitCourseWebhookEvent: vi.fn() }));
vi.mock('@cio/db/queries/notifications', () => ({ createNotification: vi.fn(), createNotifications: vi.fn() }));

import { ErrorCodes } from '@api/utils/errors';
import { createNewsfeedCommentService, getNewsfeedCommentThreadService } from './newsfeed';

const feedId = 'feed-a';
const foreignFeedId = 'feed-b';

function comment(id: number, courseNewsfeedId: string, parentId: number | null) {
  return { id, courseNewsfeedId, parentId };
}

function threadOptions(rootId: number) {
  return { rootId, rootLimit: 5, childLimit: 3, maxDepth: 3 };
}

function expectCommentNotFound(promise: Promise<unknown>) {
  return expect(promise).rejects.toMatchObject({ code: ErrorCodes.COMMENT_NOT_FOUND, statusCode: 404 });
}

describe('newsfeed comment feed binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createNewsfeedComment.mockResolvedValue({ id: 99 });
    mocks.getNewsfeedById.mockResolvedValue({ id: feedId });
    mocks.getNewsfeedCommentDepth.mockResolvedValue(0);
    mocks.getNewsfeedCommentThread.mockResolvedValue({ items: [] });
  });

  it('rejects subtree fetches with a missing root before reading the thread', async () => {
    mocks.getNewsfeedCommentById.mockResolvedValue(null);

    await expectCommentNotFound(getNewsfeedCommentThreadService(feedId, threadOptions(1)));

    expect(mocks.getNewsfeedCommentThread).not.toHaveBeenCalled();
  });

  it('rejects subtree fetches with a foreign-feed root before reading the thread', async () => {
    mocks.getNewsfeedCommentById.mockResolvedValue(comment(1, foreignFeedId, null));

    await expectCommentNotFound(getNewsfeedCommentThreadService(feedId, threadOptions(1)));

    expect(mocks.getNewsfeedCommentThread).not.toHaveBeenCalled();
  });

  it('fetches the subtree for a root in the requested feed', async () => {
    mocks.getNewsfeedCommentById.mockResolvedValue(comment(1, feedId, null));

    await expect(getNewsfeedCommentThreadService(feedId, threadOptions(1))).resolves.toEqual({ items: [] });

    expect(mocks.getNewsfeedCommentThread).toHaveBeenCalledWith(feedId, threadOptions(1));
  });

  it('rejects replies with a foreign parent before insert', async () => {
    mocks.getNewsfeedCommentById.mockResolvedValue(comment(1, foreignFeedId, null));

    await expectCommentNotFound(createNewsfeedCommentService(feedId, 'author-a', 'Reply', 1));

    expect(mocks.createNewsfeedComment).not.toHaveBeenCalled();
  });

  it('creates replies for a same-feed parent at any depth', async () => {
    mocks.getNewsfeedCommentById.mockResolvedValue(comment(2, feedId, 1));
    mocks.getNewsfeedCommentDepth.mockResolvedValue(3);

    await expect(createNewsfeedCommentService(feedId, 'author-a', 'Reply', 2)).resolves.toEqual({ id: 99 });

    expect(mocks.createNewsfeedComment).toHaveBeenCalledWith({
      authorId: 'author-a',
      content: 'Reply',
      courseNewsfeedId: feedId,
      parentId: 2,
      replyToCommentId: null
    });
  });

  it('rejects replies nested past the depth cap before insert', async () => {
    mocks.getNewsfeedCommentById.mockResolvedValue(comment(2, feedId, 1));
    mocks.getNewsfeedCommentDepth.mockResolvedValue(50);

    await expect(createNewsfeedCommentService(feedId, 'author-a', 'Reply', 2)).rejects.toMatchObject({
      code: ErrorCodes.VALIDATION_ERROR,
      statusCode: 400
    });

    expect(mocks.createNewsfeedComment).not.toHaveBeenCalled();
  });
});
