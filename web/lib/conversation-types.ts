import { z } from "zod";
import type { UIMessage } from "ai";

export const savedMessageSchema = z.object({
  id: z.string().min(1).max(128),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
}).strict();
export const conversationSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  title: z.string().min(1).max(80),
  messages: z.array(savedMessageSchema).max(40),
  draft: z.string().max(8000),
  draft_version: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  status: z.enum(["ready", "streaming", "interrupted"]),
  run_id: z.string().uuid().nullable(),
  run_expires_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export const conversationSummarySchema = conversationSchema.pick({
  id: true, title: true, status: true, created_at: true, updated_at: true,
});
export const conversationResponseSchema = z.object({ conversation: conversationSchema });
export const conversationListSchema = z.object({
  conversations: z.array(conversationSummarySchema), hasMore: z.boolean(),
});
export const conversationPatchSchema = z.union([
  z.object({ title: z.string().trim().min(1).max(80) }).strict(),
  z.object({ draft: z.string().max(8000), draftVersion: z.number().int().nonnegative() }).strict(),
]);
export type SavedMessage = z.infer<typeof savedMessageSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

export function savedMessages(messages: UIMessage[]): SavedMessage[] {
  return messages.flatMap(({ id, role, parts }) => {
    const content = parts.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
    return (role === "user" || role === "assistant") && content ? [{ id, role, content }] : [];
  });
}

export function restoredMessages(messages: SavedMessage[]): UIMessage[] {
  return messages.map(({ id, role, content }) => ({ id, role, parts: [{ type: "text", text: content }] }));
}

export function conversationBusy(conversation: Conversation) {
  return conversation.status === "streaming"
    && Date.parse(conversation.run_expires_at ?? "") > Date.now();
}
