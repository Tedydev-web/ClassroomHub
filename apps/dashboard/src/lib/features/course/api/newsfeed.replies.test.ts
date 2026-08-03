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

function successfulCommentsResponse(data: {
  items: Array<{ id: number; content: string }>;
  totalCount: number;
  hasMore: boolean;
  nextCursor: string | null;
}) {
  return new Response(JSON.stringify({ success: true, data }));
}

describe('NewsfeedApi reply pagination', () => {
  it('gets replies through the comments endpoint and stores the response state', async () => {
    mocks.commentsGet.mockResolvedValueOnce(
      successfulCommentsResponse({
        items: [{ id: 8, content: 'First reply' }],
        totalCount: 2,
        hasMore: true,
        nextCursor: 'reply-cursor'
      })
    );
    const api = new NewsfeedApi();

    await expect(api.getReplies('course-a', 'feed-b', 7, 2)).resolves.toBeUndefined();

    expect(mocks.commentsGet).toHaveBeenCalledWith({
      param: { courseId: 'course-a', feedId: 'feed-b' },
      query: { parentId: '7', limit: '2' }
    });
    expect(api.repliesByParentId[7]).toEqual({
      items: [{ id: 8, content: 'First reply' }],
      totalCount: 2,
      hasMore: true,
      isLoading: false,
      cursor: 'reply-cursor'
    });
  });

  it('loads the next reply page through the comments endpoint and appends it', async () => {
    mocks.commentsGet.mockResolvedValueOnce(
      successfulCommentsResponse({
        items: [{ id: 9, content: 'Second reply' }],
        totalCount: 2,
        hasMore: false,
        nextCursor: null
      })
    );
    const api = new NewsfeedApi();
    api.repliesByParentId[7] = {
      items: [{ id: 8, content: 'First reply' }],
      totalCount: 2,
      hasMore: true,
      isLoading: false,
      cursor: 'reply-cursor'
    };

    await expect(api.loadMoreReplies('course-a', 'feed-b', 7, 2)).resolves.toBeUndefined();

    expect(mocks.commentsGet).toHaveBeenCalledWith({
      param: { courseId: 'course-a', feedId: 'feed-b' },
      query: { parentId: '7', cursor: 'reply-cursor', limit: '2' }
    });
    expect(api.repliesByParentId[7]).toEqual({
      items: [
        { id: 8, content: 'First reply' },
        { id: 9, content: 'Second reply' }
      ],
      totalCount: 2,
      hasMore: false,
      isLoading: false,
      cursor: null
    });
  });
});
