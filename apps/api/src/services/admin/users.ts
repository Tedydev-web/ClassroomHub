import { AppError, ErrorCodes } from '@api/utils/errors';
import {
  getUserChat,
  getUserWithStats,
  listUserChats,
  listUsers,
  type AdminUserWithStats,
  type ChatConversation,
  type ChatSummary
} from '@cio/db/queries/admin';

import { PRODUCT_HOSTS } from '@cio/utils/constants';
import { getProfileById } from '@cio/db/queries/auth';
import { mintLoginLinkToken } from '@cio/db/auth';

const IMPERSONATION_TTL_MINUTES = 60;

export function listAdminUsers(params: { page: number; limit: number; search?: string }) {
  return listUsers(params);
}

export async function getAdminUserStats(userId: string): Promise<AdminUserWithStats> {
  const stats = await getUserWithStats(userId);
  if (!stats) {
    throw new AppError(`User '${userId}' not found`, ErrorCodes.NOT_FOUND, 404);
  }
  return stats;
}

export function listAdminUserChats(userId: string): Promise<ChatSummary[]> {
  return listUserChats(userId);
}

export async function getAdminUserChat(conversationId: string, userId: string): Promise<ChatConversation> {
  const chat = await getUserChat(conversationId, userId);
  if (!chat) {
    throw new AppError(`Conversation '${conversationId}' not found for this user`, ErrorCodes.NOT_FOUND, 404);
  }
  return chat;
}

/**
 * Mints a one-time login link so the operator can act as a user. The token is
 * bound to that user's id and email; the operator opens the URL in a new tab and
 * lands in the dashboard as them. Short TTL because it is a live credential.
 */
export async function impersonateUser(userId: string): Promise<{ loginUrl: string }> {
  const profile = await getProfileById(userId);
  if (!profile?.email) {
    throw new AppError(`User '${userId}' not found`, ErrorCodes.NOT_FOUND, 404);
  }

  const token = await mintLoginLinkToken({
    userId,
    email: profile.email,
    ttlMinutes: IMPERSONATION_TTL_MINUTES
  });

  const url = new URL(`https://${PRODUCT_HOSTS.dashboard}/api/auth/login-link`);
  url.searchParams.set('token', token);
  url.searchParams.set('redirect', '/home');

  return { loginUrl: url.toString() };
}
