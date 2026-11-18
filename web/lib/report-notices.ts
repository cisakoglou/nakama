import type { Conversation, ConversationSummary } from "@/lib/conversation-types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LIST_REFRESH_INTERVAL_MS = 15_000;

// `?chat=<uuid>` from a notification; anything else is ignored.
export function chatDeepLink(search: string) {
  const id = new URLSearchParams(search).get("chat")?.trim();
  return id && UUID.test(id) ? id.toLowerCase() : null;
}

// The current URL without `chat`, for history.replaceState after opening the deep link.
export function withoutChatParam(href: string) {
  const url = new URL(href);
  url.searchParams.delete("chat");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function isWorkoutReport(chat: Pick<ConversationSummary, "first_message_id"> | Pick<Conversation, "messages">) {
  const firstMessageId = "first_message_id" in chat ? chat.first_message_id : chat.messages[0]?.id;
  return firstMessageId?.startsWith("workout-report-") ?? false;
}

// Report chats created after the user last looked at the list. created_at (not updated_at) so that
// chatting inside an old report does not mark it new again. Without a stored mark nothing is new.
export function newReportIds(chats: ConversationSummary[], seenAt: string | null, activeId: string | null = null) {
  const seen = seenAt ? Date.parse(seenAt) : Number.NaN;
  if (Number.isNaN(seen)) return new Set<string>();
  return new Set(chats.filter((chat) => chat.id !== activeId && isWorkoutReport(chat)
    && Date.parse(chat.created_at) > seen).map((chat) => chat.id));
}

// Newest created_at in the list (server clock), so the mark never depends on the device clock.
export function latestCreatedAt(chats: ConversationSummary[], fallback: string | null) {
  return chats.reduce<string | null>((latest, chat) =>
    latest === null || Date.parse(chat.created_at) > Date.parse(latest) ? chat.created_at : latest, fallback);
}

// Refreshed first page on top; older pages already loaded are kept, newest activity first.
export function mergeLatest(fresh: ConversationSummary[], current: ConversationSummary[]) {
  const ids = new Set(fresh.map((chat) => chat.id));
  return [...fresh, ...current.filter((chat) => !ids.has(chat.id))]
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || b.id.localeCompare(a.id));
}

// Per-account "last saw the chat list" mark. Storage access may throw (private mode, blocked site data).
export function reportsSeenStore(storage: Storage, userId: string) {
  const key = `nakama:reports-seen:${userId}`;
  return {
    get(): string | null {
      try {
        const value = storage.getItem(key);
        return value && !Number.isNaN(Date.parse(value)) ? value : null;
      } catch { return null; }
    },
    set(value: string) {
      try { storage.setItem(key, value); } catch { /* the badge falls back to this session only */ }
    },
  };
}
