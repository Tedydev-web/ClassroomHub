import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const commentsGet = vi.fn();

  Object.assign(globalThis, { $state: <T>(value: T) => value });

  return { commentsGet };
});

vi.mock('$lib/utils/services/api', () => {
  class BaseApiWithErrors {
    errors = {};

    async execute<ResponseType>(options: {
      requestFn: () => Promise<Response>;
      onSuccess?: (response: ResponseType) => Promise<void> | void;
    }) {
      const response = await options.requestFn();
      const result = (await response.json()) as ResponseType;

      await options.onSuccess?.(result);
      return result;
    }
  }

  return {
    BaseApiWithErrors,
    classroomhub: {
      course: {
        ':courseId': {
          newsfeed: {
            ':feedId': {
              comments: { $get: mocks.commentsGet }
            }
          }
        }
      }
    }
  };
});

vi.mock('$features/ui/snackbar/store', () => ({
  snackbar: { error: vi.fn(), success: vi.fn() }
}));

vi.mock('$lib/utils/functions/toHtml', () => ({
  isHtmlValueEmpty: vi.fn()
}));

vi.mock('$lib/utils/validation', () => ({
  mapZodErrorsToTranslations: vi.fn()
}));

vi.mock('$lib/utils/store/user', () => ({
  profile: {}
}));

import { NewsfeedApi } from './newsfeed.svelte';

function commentItem(overrides: {
  id: number;
  parentId: number | null;
  depth: number;
  content: string;
  hasMoreChildren?: boolean;
}) {
  return {
    directReplyCount: 0,
    descendantCount: 0,
    loadedChildCount: 0,
    hasMoreChildren: false,
    ...overrides
  };
}

function successfulCommentsResponse(data: {
  items: ReturnType<typeof commentItem>[];
  rootId: number | null;
  totalRootCount: number;
  totalCommentCount: number;
  hasMore: boolean;
  nextCursor: string | null;
}) {
  return new Response(JSON.stringify({ success: true, data }));
}

describe('NewsfeedApi thread pagination', () => {
  it('fetches the root thread through the comments endpoint and stores the response state', async () => {
    mocks.commentsGet.mockResolvedValueOnce(
      successfulCommentsResponse({
        items: [commentItem({ id: 7, parentId: null, depth: 0, content: 'Root', hasMoreChildren: true })],
        rootId: null,
        totalRootCount: 1,
        totalCommentCount: 2,
        hasMore: true,
        nextCursor: 'root-cursor'
      })
    );
    const api = new NewsfeedApi();

    await expect(api.getThread('course-a', 'feed-b', { limit: 2 })).resolves.toBeUndefined();

    expect(mocks.commentsGet).toHaveBeenCalledWith({
      param: { courseId: 'course-a', feedId: 'feed-b' },
      query: { limit: '2', childLimit: '3', maxDepth: '3' }
    });
    expect(api.threadByFeedId['feed-b']).toMatchObject({
      rootIds: [7],
      totalRootCount: 1,
      totalCommentCount: 2,
      hasMore: true,
      cursor: 'root-cursor',
      isLoading: false
    });
  });

  it('loads a comment subtree through the comments endpoint and appends it', async () => {
    mocks.commentsGet
      .mockResolvedValueOnce(
        successfulCommentsResponse({
          items: [commentItem({ id: 7, parentId: null, depth: 0, content: 'Root', hasMoreChildren: true })],
          rootId: null,
          totalRootCount: 1,
          totalCommentCount: 2,
          hasMore: false,
          nextCursor: null
        })
      )
      .mockResolvedValueOnce(
        successfulCommentsResponse({
          items: [commentItem({ id: 8, parentId: 7, depth: 1, content: 'Reply' })],
          rootId: 7,
          totalRootCount: 1,
          totalCommentCount: 2,
          hasMore: false,
          nextCursor: null
        })
      );
    const api = new NewsfeedApi();
    await api.getThread('course-a', 'feed-b');

    await expect(api.loadMoreReplies('course-a', 'feed-b', 7)).resolves.toBeUndefined();

    expect(mocks.commentsGet).toHaveBeenLastCalledWith({
      param: { courseId: 'course-a', feedId: 'feed-b' },
      query: { rootId: '7', childLimit: '3', maxDepth: '3' }
    });
    expect(api.childIdsByParent['7']).toEqual([8]);
    expect(api.commentById['8']).toMatchObject({ id: 8, content: 'Reply' });
  });
});
