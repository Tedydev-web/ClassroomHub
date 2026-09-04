<script lang="ts">
  import * as Popover from '@cio/ui/base/popover';
  import { Input } from '@cio/ui/base/input';
  import { tick } from 'svelte';
  import SparklesIcon from '@lucide/svelte/icons/sparkles';
  import XIcon from '@lucide/svelte/icons/x';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import HistoryIcon from '@lucide/svelte/icons/history';
  import ChatHistoryPopover from '$features/ai-assistant/chat-history-popover.svelte';
  import { closeAiAssistant } from '$features/ai-assistant/utils/store';
  import { t } from '$lib/utils/functions/translations';
  import { IconButton } from '@cio/ui/custom/icon-button';
  import { Button } from '@cio/ui/base/button';

  interface Conversation {
    id: string;
    title: string | null;
    updatedAt: string;
  }

  interface TokenUsage {
    used: number;
    allowance: number;
    remaining: number;
    isUnlimited: boolean;
  }

  interface GatewayUsage {
    usedUnits: number;
    budgetUnits: number;
    windowMinutes: number;
  }

  interface StudentMessageUsage {
    used: number;
    cap: number;
  }

  interface Props {
    tokenUsage: TokenUsage | null;
    /** This workspace's share of the shared AI capacity, when a budget is configured. */
    gatewayUsage: GatewayUsage | null;
    isStudent: boolean;
    studentMessageUsage: StudentMessageUsage | null;
    conversations: Conversation[];
    activeConversationId: string | null;
    conversationTitle: string | null;
    isNewChatDisabled: boolean;
    onNewChat: () => void;
    onLoadConversation: (id: string) => void;
    onDeleteConversation: (id: string) => void;
    /** Resolves on success; rejects with Error when rename fails (message is user-presentable). */
    onRenameConversation: (id: string, title: string) => Promise<void>;
  }

  let {
    tokenUsage,
    gatewayUsage,
    isStudent,
    studentMessageUsage,
    conversations,
    activeConversationId,
    conversationTitle,
    isNewChatDisabled,
    onNewChat,
    onLoadConversation,
    onDeleteConversation,
    onRenameConversation
  }: Props = $props();

  let historyPopoverOpen = $state(false);

  /** Clamped so an over-budget window still renders a full bar rather than overflowing. */
  function toPercent(used: number, total: number): number {
    if (total <= 0) return 0;

    return Math.min(100, Math.round((used / total) * 100));
  }

  const gatewayPercent = $derived(gatewayUsage ? toPercent(gatewayUsage.usedUnits, gatewayUsage.budgetUnits) : 0);
  const gatewayWindowDays = $derived(gatewayUsage ? Math.max(1, Math.round(gatewayUsage.windowMinutes / 1440)) : 0);

  let editingConversationTitle = $state(false);
  let draftConversationTitle = $state('');
  let renameConversationError = $state<string | null>(null);
  let titleInputRef: HTMLInputElement | null = $state(null);

  let renameCommitInFlight = $state(false);
  let snapshotConversationIdForRename = $state<string | null>(null);

  const canRenameConversation = $derived(
    Boolean(activeConversationId && conversationTitle && conversationTitle !== 'New conversation')
  );

  function handleLoadConversation(id: string) {
    onLoadConversation(id);
    historyPopoverOpen = false;
  }

  function cancelRenameConversation() {
    if (renameCommitInFlight) {
      return;
    }

    if (!editingConversationTitle) {
      return;
    }

    editingConversationTitle = false;
    renameConversationError = null;
    draftConversationTitle = conversationTitle ?? '';
    snapshotConversationIdForRename = null;
  }

  $effect(() => {
    if (
      editingConversationTitle &&
      snapshotConversationIdForRename != null &&
      activeConversationId !== snapshotConversationIdForRename
    ) {
      cancelRenameConversation();
    }
  });

  async function startRenameConversation() {
    if (!canRenameConversation || !activeConversationId || !conversationTitle) {
      return;
    }

    renameConversationError = null;
    draftConversationTitle = conversationTitle;
    snapshotConversationIdForRename = activeConversationId;
    editingConversationTitle = true;

    await tick();

    titleInputRef?.focus();
    titleInputRef?.select();
  }

  async function commitRenameConversation() {
    if (!activeConversationId) {
      return;
    }

    const trimmedTitle = draftConversationTitle.trim();

    if (trimmedTitle.length === 0) {
      cancelRenameConversation();

      return;
    }

    if (trimmedTitle === conversationTitle) {
      editingConversationTitle = false;
      renameConversationError = null;
      snapshotConversationIdForRename = null;

      return;
    }

    renameCommitInFlight = true;

    try {
      await onRenameConversation(activeConversationId, trimmedTitle);
      editingConversationTitle = false;
      renameConversationError = null;
      snapshotConversationIdForRename = null;
    } catch (renameError) {
      const message = renameError instanceof Error ? renameError.message : t.get('ai_assistant.rename_chat_failed');

      renameConversationError = message;
    } finally {
      renameCommitInFlight = false;
    }
  }

  function handleTitleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void commitRenameConversation();
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      cancelRenameConversation();
    }
  }
</script>

<div class="border-b px-4 py-3">
  <div class="flex items-center justify-between">
    <div class="flex min-w-0 items-center gap-2">
      <SparklesIcon size={18} class="ui:text-primary shrink-0" />
      <div class="min-w-0">
        <h3 class="text-sm font-semibold">{$t('course.navItems.nav_ai_assistant')}</h3>
        {#if conversationTitle && conversationTitle !== 'New conversation'}
          {#if editingConversationTitle}
            <div class="min-w-0">
              <Input
                bind:ref={titleInputRef}
                bind:value={draftConversationTitle}
                class="h-7 min-h-0 px-1.5 py-0 text-xs"
                placeholder={$t('ai_assistant.rename_chat_placeholder')}
                aria-label={$t('ai_assistant.rename_chat_input_aria')}
                onkeydown={handleTitleKeydown}
                onblur={cancelRenameConversation}
              />
              {#if renameConversationError}
                <p class="ui:text-destructive mt-0.5 text-[10px]">{renameConversationError}</p>
              {/if}
            </div>
          {:else}
            <button
              type="button"
              class="ui:text-muted-foreground ui:hover:bg-muted/40 ui:hover:border-border max-w-full cursor-pointer truncate rounded-md border border-transparent px-1.5 py-0.5 text-left text-xs"
              aria-label={$t('ai_assistant.rename_chat_aria')}
              disabled={!canRenameConversation}
              onclick={startRenameConversation}
            >
              {conversationTitle}
            </button>
          {/if}
        {/if}
      </div>
    </div>
    <div class="flex items-center gap-2">
      <IconButton
        onclick={onNewChat}
        disabled={isNewChatDisabled}
        variant="outline"
        size="icon-xs"
        tooltip={$t('ai_assistant.new_chat')}
      >
        <PlusIcon size={16} />
      </IconButton>

      <Popover.Root bind:open={historyPopoverOpen}>
        <Popover.Trigger>
          {#snippet child({ props })}
            <Button
              variant="outline"
              size="icon-xs"
              {...props}
              aria-label={$t('ai_assistant.chat_history')}
              title={$t('ai_assistant.chat_history')}
            >
              <HistoryIcon size={16} />
            </Button>
          {/snippet}
        </Popover.Trigger>
        <Popover.Content class="w-72 p-0!" align="center">
          <ChatHistoryPopover
            {conversations}
            {activeConversationId}
            onLoad={handleLoadConversation}
            onDelete={onDeleteConversation}
          />
        </Popover.Content>
      </Popover.Root>

      <IconButton onclick={closeAiAssistant} variant="outline" size="icon-xs">
        <XIcon size={16} />
      </IconButton>
    </div>
  </div>
  {#if isStudent && studentMessageUsage}
    {@render meter(
      `${studentMessageUsage.used.toLocaleString()} / ${studentMessageUsage.cap.toLocaleString()} ${$t('ai_assistant.messages_used_label')}`,
      toPercent(studentMessageUsage.used, studentMessageUsage.cap),
      null
    )}
  {:else if !isStudent && gatewayUsage}
    <!--
      Progress against this workspace's own slice of the shared subscription. This
      is the only denominator a teacher can act on: the plan allowance is
      unbounded on this deployment, and the shared pool total is other tenants'
      business.
    -->
    {@render meter(
      `${gatewayUsage.usedUnits.toLocaleString()} / ${gatewayUsage.budgetUnits.toLocaleString()} ${$t('ai_assistant.capacity_label')}`,
      gatewayPercent,
      $t('ai_assistant.capacity_hint', { days: gatewayWindowDays })
    )}
  {:else if !isStudent && tokenUsage?.isUnlimited}
    <!--
      No plan ceiling and no configured capacity budget, so a used/total fraction
      would divide by a sentinel and read 0% forever. Show consumption on its own
      instead of implying a budget that does not exist.
    -->
    <div class="mt-2">
      <div class="ui:text-muted-foreground text-[10px]">
        {tokenUsage.used.toLocaleString()}
        {$t('ai_assistant.tokens_label')}
      </div>
    </div>
  {:else if !isStudent && tokenUsage && tokenUsage.used + tokenUsage.remaining > 0}
    {@const totalBudget = tokenUsage.used + tokenUsage.remaining}
    {@render meter(
      `${tokenUsage.used.toLocaleString()} / ${totalBudget.toLocaleString()} ${$t('ai_assistant.tokens_label')}`,
      toPercent(tokenUsage.used, totalBudget),
      null
    )}
  {/if}
</div>

{#snippet meter(label: string, percent: number, hint: string | null)}
  <div class="mt-2" title={hint ?? undefined}>
    <div class="ui:text-muted-foreground flex justify-between text-[10px]">
      <span>{label}</span>
      <span>{percent}%</span>
    </div>
    <div class="ui:bg-muted mt-0.5 h-1 w-full rounded-full">
      <div
        class="h-1 rounded-full transition-all {percent > 90
          ? 'bg-red-500'
          : percent > 70
            ? 'bg-amber-500'
            : 'ui:bg-primary'}"
        style="width: {percent}%"
      ></div>
    </div>
  </div>
{/snippet}
