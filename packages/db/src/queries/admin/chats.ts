import { and, desc, eq, sql } from 'drizzle-orm';

import * as schema from '@db/schema';
import { db } from '@db/drizzle';

export type ChatSummary = {
  id: string;
  title: string | null;
  courseId: string;
  updatedAt: string;
  messageCount: number;
};

/**
 * A user's AI conversations for the super-admin inspection view — summaries
 * only, so the list stays cheap. `messageCount` is derived from the JSONB array
 * length rather than shipping the whole transcript for every row.
 */
export async function listUserChats(userId: string): Promise<ChatSummary[]> {
  return db
    .select({
      id: schema.aiChatConversation.id,
      title: schema.aiChatConversation.title,
      courseId: schema.aiChatConversation.courseId,
      updatedAt: schema.aiChatConversation.updatedAt,
      messageCount: sql<number>`coalesce(jsonb_array_length(${schema.aiChatConversation.messages}), 0)::int`
    })
    .from(schema.aiChatConversation)
    .where(eq(schema.aiChatConversation.userId, userId))
    .orderBy(desc(schema.aiChatConversation.updatedAt));
}

export type ChatConversation = {
  id: string;
  title: string | null;
  courseId: string;
  messages: unknown;
  updatedAt: string;
};

/**
 * One full transcript. Scoped to `userId` as well as the conversation id so the
 * super-admin cannot read a conversation by guessing an id that belongs to a
 * different user — the id in the URL is not proof of ownership.
 */
export async function getUserChat(conversationId: string, userId: string): Promise<ChatConversation | null> {
  const [row] = await db
    .select({
      id: schema.aiChatConversation.id,
      title: schema.aiChatConversation.title,
      courseId: schema.aiChatConversation.courseId,
      messages: schema.aiChatConversation.messages,
      updatedAt: schema.aiChatConversation.updatedAt
    })
    .from(schema.aiChatConversation)
    .where(and(eq(schema.aiChatConversation.id, conversationId), eq(schema.aiChatConversation.userId, userId)))
    .limit(1);

  return row ?? null;
}
