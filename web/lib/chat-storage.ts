import type { Message } from "ai";

const STORAGE_KEY = "nakama:current-chat:v1";
type ChatStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type SavedMessage = Pick<Message, "id" | "content"> & { role: "user" | "assistant" };

export type SavedChat = {
  messages: SavedMessage[];
  input: string;
  interrupted: boolean;
};

function isSavedMessage(value: unknown): value is SavedMessage {
  return typeof value === "object" && value !== null
    && "id" in value && typeof value.id === "string" && value.id.length > 0
    && "role" in value && (value.role === "user" || value.role === "assistant")
    && "content" in value && typeof value.content === "string";
}

export function loadChat(storage: ChatStorage): SavedChat {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return { messages: [], input: "", interrupted: false };
  const saved: unknown = JSON.parse(raw);
  if (
    typeof saved !== "object" || saved === null
    || !("version" in saved) || saved.version !== 1
    || !("messages" in saved) || !Array.isArray(saved.messages)
    || !saved.messages.every(isSavedMessage)
    || !("input" in saved) || typeof saved.input !== "string"
    || !("interrupted" in saved) || typeof saved.interrupted !== "boolean"
  ) {
    throw new Error("The saved conversation is invalid.");
  }
  return {
    messages: saved.messages.map(({ id, role, content }) => ({ id, role, content })),
    input: saved.input,
    interrupted: saved.interrupted,
  };
}

export function saveChat(
  storage: ChatStorage,
  chat: { messages: Message[]; input: string; interrupted: boolean },
): void {
  const messages: SavedMessage[] = chat.messages.flatMap(({ id, role, content }) =>
    (role === "user" || role === "assistant") && content
      ? [{ id, role, content }] : [],
  );
  if (messages.length === 0 && !chat.input) {
    storage.removeItem(STORAGE_KEY);
    return;
  }
  storage.setItem(STORAGE_KEY, JSON.stringify({
    version: 1, messages, input: chat.input, interrupted: chat.interrupted,
  }));
}
