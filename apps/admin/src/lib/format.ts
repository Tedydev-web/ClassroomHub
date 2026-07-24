import type { ChatConversation, ChatMessage } from './types';

/** `2026-07-24` — stable, locale-independent, sorts correctly. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().slice(0, 10);
}

/** Coarse relative age for a list, e.g. "3d ago". Precise enough for triage. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

/**
 * Initials for the avatar fallback: "Ada Lovelace" → "AL", single name → its
 * first letter, and — with no name — just the first letter of the email, since
 * "CG" derived from `classroomhub@gmail` reads as a wrong name rather than a
 * fallback.
 */
export function initials(name: string | null, email: string): string {
  const trimmed = name?.trim();
  if (!trimmed) {
    return (email.trim().charAt(0) || '?').toUpperCase();
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === 'string'
          ? part
          : typeof (part as { text?: unknown })?.text === 'string'
            ? (part as { text: string }).text
            : ''
      )
      .filter(Boolean)
      .join('\n');
  }
  if (content && typeof content === 'object' && typeof (content as { text?: unknown }).text === 'string') {
    return (content as { text: string }).text;
  }
  return '';
}

/**
 * Renders a conversation as a plain-text transcript for the "Copy chat" button —
 * one `ROLE:` block per message, so a pasted transcript reads as a dialogue
 * rather than a JSON dump.
 */
export function chatToPlainText(chat: ChatConversation): string {
  const header = `${chat.title ?? 'Untitled conversation'} — ${formatDate(chat.updatedAt)}\n`;
  const body = (chat.messages ?? [])
    .map((m: ChatMessage) => {
      const role = (m.role ?? 'message').toUpperCase();
      const text = messageText(m.content).trim();
      return `${role}:\n${text}`;
    })
    .join('\n\n');
  return `${header}\n${body}\n`;
}
