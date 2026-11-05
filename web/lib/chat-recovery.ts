import { z } from "zod";

const draftSchema = z.object({
  input: z.string().max(8000), version: z.number().int().nonnegative(),
}).strict();
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

export function chatRecovery(storage: Storage, userId: string) {
  const activeKey = `nakama:active-chat:${userId}`;
  const draftKey = (id: string) => `nakama:chat-draft:${userId}:${id}`;
  return {
    active() {
      const value = storage.getItem(activeKey);
      return value === null ? null : z.string().uuid().parse(value);
    },
    select(id: string | null) {
      if (id) storage.setItem(activeKey, id);
      else storage.removeItem(activeKey);
    },
    draft(id: string) {
      const value = storage.getItem(draftKey(id));
      return value === null ? null : draftSchema.parse(JSON.parse(value));
    },
    saveDraft(id: string, input: string, version: number) {
      storage.setItem(draftKey(id), JSON.stringify({ input, version }));
    },
    clearDraft(id: string) { storage.removeItem(draftKey(id)); },
  };
}
