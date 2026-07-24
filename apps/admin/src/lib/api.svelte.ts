import type { AdminUserWithStats, ChatConversation, ChatSummary, CreatedOrg, ListUsersResult } from './types';

/**
 * Thin client over the super-admin API. Every request carries the operator's
 * password as `X-Super-Admin-Key`; the SvelteKit server proxy forwards it to the
 * API. Uses plain `fetch` and hand-written types so this app never imports the
 * API package's Hono RPC client.
 */
export class AdminApi {
  constructor(private readonly password: string) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`/api/admin${path}`, {
      ...init,
      headers: {
        'X-Super-Admin-Key': this.password,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers
      }
    });

    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // fall through to the status-based error below
    }

    if (!res.ok || !body || typeof body !== 'object' || (body as { success?: boolean }).success !== true) {
      const message =
        (body as { error?: string; message?: string })?.error ??
        (body as { message?: string })?.message ??
        `Request failed (${res.status})`;
      throw new Error(message);
    }

    return (body as { data: T }).data;
  }

  /** Cheapest authenticated call — used by the gate to validate the password. */
  verify(): Promise<ListUsersResult> {
    return this.call<ListUsersResult>('/users?limit=1');
  }

  listUsers(page: number, search?: string): Promise<ListUsersResult> {
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (search) params.set('search', search);
    return this.call<ListUsersResult>(`/users?${params.toString()}`);
  }

  getUser(userId: string): Promise<AdminUserWithStats> {
    return this.call<AdminUserWithStats>(`/users/${userId}`);
  }

  listChats(userId: string): Promise<ChatSummary[]> {
    return this.call<ChatSummary[]>(`/users/${userId}/chats`);
  }

  getChat(userId: string, chatId: string): Promise<ChatConversation> {
    return this.call<ChatConversation>(`/users/${userId}/chats/${chatId}`);
  }

  impersonate(userId: string): Promise<{ loginUrl: string }> {
    return this.call<{ loginUrl: string }>(`/users/${userId}/impersonate`, { method: 'POST' });
  }

  addCredits(orgId: string, amount: number): Promise<{ balance: number }> {
    return this.call<{ balance: number }>(`/orgs/${orgId}/credits`, {
      method: 'POST',
      body: JSON.stringify({ amount })
    });
  }

  createOrg(input: { name: string; siteName: string; ownerUserId: string }): Promise<CreatedOrg> {
    return this.call<CreatedOrg>('/orgs', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  }
}
