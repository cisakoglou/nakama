import { expect, it } from "vitest";
import { chatRecovery } from "./chat-recovery";
import { restoredMessages, savedMessages } from "./conversation-types";

it("isolates selected conversations and drafts by user and chat", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const one = chatRecovery(storage, "one");
  const two = chatRecovery(storage, "two");
  const id = "00000000-0000-4000-8000-000000000001";
  one.select(id);
  one.saveDraft(id, "My training draft", 3);
  expect(two.active()).toBeNull();
  expect(two.draft(id)).toBeNull();
  expect(one.draft(id)).toEqual({ input: "My training draft", version: 3 });
  expect(one.draft("another-chat")).toBeNull();
  one.clearDraft(id);
  expect(one.draft(id)).toBeNull();
  expect(one.active()).toBe(id);
});

it("restores text context without retaining executable tool parts, approvals, or raw results", () => {
  const transcript = savedMessages([{
    id: "assistant", role: "assistant", parts: [
      { type: "text", text: "Here is your next session." },
      {
        type: "dynamic-tool", toolName: "update-routine", toolCallId: "call",
        state: "approval-requested", input: { private: "raw data" }, approval: { id: "approval" },
      },
    ],
  }]);
  expect(restoredMessages(transcript)).toEqual([{
    id: "assistant", role: "assistant", parts: [{ type: "text", text: "Here is your next session." }],
  }]);
});
