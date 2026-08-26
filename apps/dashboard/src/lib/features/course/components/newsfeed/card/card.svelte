<script lang="ts">
  import { onMount, tick } from 'svelte';

  import type { Feed } from '$features/course/utils/types';
  import { t } from '$lib/utils/functions/translations';
  import { newsfeedApi } from '$features/course/api';
  import {
    getNewsfeedReactionCounts,
    getSelectedNewsfeedReactionType,
    type NewsfeedReactionType
  } from '@cio/ui/custom/newsfeed-reactions';

  import PinIcon from '@lucide/svelte/icons/pin';

  import DeleteConfirmation from './delete-confirmation.svelte';
  import Header from './header.svelte';
  import { NewsfeedReactions } from '@cio/ui/custom/newsfeed-reactions';
  import Comments from './comments.svelte';

  interface Props {
    feed: Feed;
    courseId?: string;
    editFeed: Feed | null;
    author: {
      id: string;
      profileId: string;
      username: string;
      fullname: string;
      avatarUrl: string;
    };
    edit?: boolean;
    deleteFeed?: (feedId: string) => void | Promise<void>;
    deleteComment?: (feedId: string, commentId: string) => void | Promise<void>;
    addNewComment?: (content: string, feedId: string) => void | Promise<void>;
    addNewReaction?: (reactionType: NewsfeedReactionType, feedId: string, authorId: string) => void | Promise<void>;
    onPin?: (feedId: Feed['id'], isPinned: Feed['isPinned']) => void | Promise<void>;
    isActive?: boolean;
    isReacting?: boolean;
  }

  let {
    feed,
    courseId,
    editFeed = $bindable(),
    author,
    edit = $bindable(false),
    deleteFeed = (_arg: string) => {},
    deleteComment = (_arg1: string, _arg2: string) => {},
    addNewComment = (_arg1: string, _arg2: string) => {},
    addNewReaction = (_arg1: string, _arg2: string, _arg3: string) => {},
    onPin = (_feedId: Feed['id'], _isPinned: Feed['isPinned']) => {},
    isActive = false,
    isReacting = false
  }: Props = $props();

  let isDeleteFeedModal = $state(false);

  const openEditFeed = async () => {
    editFeed = feed;
    edit = true;
    await tick();
    newsfeedApi.openNewFeedModal();
  };

  const handleReact = (reactionType: string) => addNewReaction(reactionType, feed.id, author.id);

  const handleDeleteFeed = () => {
    deleteFeed(feed.id);
  };

  const reactionCounts = $derived(getNewsfeedReactionCounts(feed.reaction));
  const selectedReactionType = $derived(getSelectedNewsfeedReactionType(feed.reaction, author.id));

  onMount(() => {
    if (isActive) {
      const el = document.getElementById(feed.id);
      el?.scrollIntoView({
        block: 'start',
        behavior: 'smooth',
        inline: 'nearest'
      });
    }
  });
</script>

<div
  id={feed.id}
  class="bg-card text-card-foreground relative mb-4 flex w-full max-w-3xl flex-col overflow-visible rounded-xl {isActive
    ? 'ring-primary border-primary ring-2'
    : 'border-border/60 border'}"
>
  {#if feed.isPinned}
    <PinIcon
      size={24}
      class="ui:text-primary ui:fill-primary pointer-events-none absolute -top-3 -left-2 z-10 -rotate-40"
      aria-hidden="true"
    />
    <span class="sr-only">{$t('course.navItem.news_feed.pinned')}</span>
  {/if}

  <Header {feed} {onPin} onEdit={openEditFeed} onRequestDelete={() => (isDeleteFeedModal = true)} />

  <div class="px-3 pb-1.5">
    <NewsfeedReactions
      {reactionCounts}
      {selectedReactionType}
      disabled={isReacting || !author.id}
      onReactionToggle={handleReact}
    />
  </div>

  <Comments
    {courseId}
    {feed}
    {author}
    onAddComment={async (content, parentId) => {
      await addNewComment(content, feed.id, parentId);
    }}
    onDeleteComment={(commentId) => {
      if (courseId) deleteComment(feed.id, String(commentId));
    }}
  />

  <DeleteConfirmation bind:openDeleteModal={isDeleteFeedModal} deleteFeed={handleDeleteFeed} />
</div>
