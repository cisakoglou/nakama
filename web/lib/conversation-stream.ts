import type { UIMessage } from "ai";
import { savedMessages, type SavedMessage } from "@/lib/conversation-types";
import type { conversationStore } from "@/lib/conversations";

export function conversationWriter(
  store: Pick<ReturnType<typeof conversationStore>, "checkpoint">,
  id: string, runId: string, initialMessages: SavedMessage[], assistantId: string,
) {
  let transcript = initialMessages.map((message) => ({ ...message }));
  let pending = Promise.resolve();
  let completion: Promise<void> | undefined;
  let lastCheckpoint = 0;

  function save(status: "streaming" | "ready" | "interrupted") {
    const snapshot = transcript.map((message) => ({ ...message }));
    pending = pending.then(() => store.checkpoint(id, runId, snapshot, status));
    return pending;
  }

  return {
    async append(text: string) {
      if (completion) return;
      const last = transcript.at(-1);
      if (last?.id === assistantId) last.content += text;
      else transcript.push({ id: assistantId, role: "assistant", content: text });
      if (Date.now() - lastCheckpoint >= 500) {
        lastCheckpoint = Date.now();
        await save("streaming");
      }
    },
    finish(messages: UIMessage[] | undefined, interrupted: boolean) {
      if (completion) return completion;
      if (messages) transcript = savedMessages(messages);
      completion = save(interrupted ? "interrupted" : "ready");
      return completion;
    },
  };
}
