import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  conversationBusy, conversationSchema, conversationSummarySchema, type Conversation, type SavedMessage,
} from "@/lib/conversation-types";
import type { Database } from "@/lib/supabase/database";

export class ConversationError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

function failure(code: string) {
  console.error("Conversation database operation failed", { code });
  return new ConversationError(503, "Your chats could not be saved or loaded. Please try again; copy any unsaved text before leaving.");
}

export async function conversationBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const text = await request.text();
  if (Buffer.byteLength(text) > 64 * 1024) throw new ConversationError(413, "This chat change is too large.");
  let body: unknown;
  try { body = JSON.parse(text); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new ConversationError(400, "Send a valid chat change.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ConversationError(400, "Send a valid chat change.");
  return parsed.data;
}

export function conversationStore(client: SupabaseClient<Database>, userId: string) {
  const table = () => client.from("chat_conversations");
  const idleFilter = () => `status.neq.streaming,run_expires_at.lte.${new Date().toISOString()}`;
  const conflict = () => new ConversationError(409, "This chat changed elsewhere or is still responding. Reopen it before continuing.");
  function parsed(data: unknown, error: { code: string } | null): Conversation {
    if (error) throw failure(error.code);
    if (!data) throw conflict();
    const result = conversationSchema.safeParse(data);
    if (!result.success) throw failure("invalid_response");
    return result.data;
  }
  return {
    async list(page: number) {
      const { data, error } = await table()
        .select("id, title, status, created_at, updated_at").eq("user_id", userId)
        .order("updated_at", { ascending: false }).order("id", { ascending: false })
        .range(page * 20, page * 20 + 20);
      if (error) throw failure(error.code);
      const rows = z.array(conversationSummarySchema).safeParse(data);
      if (!rows.success) throw failure("invalid_response");
      return { conversations: rows.data.slice(0, 20), hasMore: rows.data.length > 20 };
    },
    async create() {
      const { data, error } = await table().insert({ user_id: userId }).select("*").single();
      return parsed(data, error);
    },
    async load(id: string) {
      const { data, error } = await table().select("*").eq("user_id", userId).eq("id", id).maybeSingle();
      if (error) throw failure(error.code);
      if (!data) throw new ConversationError(404, "This chat was not found.");
      return parsed(data, null);
    },
    async patch(id: string, change: { title: string } | { draft: string; draftVersion: number }) {
      const update = "title" in change
        ? { title: change.title } : { draft: change.draft, draft_version: change.draftVersion + 1 };
      let query = table().update(update).eq("user_id", userId).eq("id", id).or(idleFilter());
      if ("draftVersion" in change) query = query.eq("draft_version", change.draftVersion);
      const { data, error } = await query.select("*").maybeSingle();
      return parsed(data, error);
    },
    async remove(id: string, revision: number) {
      const { data, error } = await table().delete().eq("user_id", userId).eq("id", id)
        .eq("revision", revision).or(idleFilter()).select("id").maybeSingle();
      if (error) throw failure(error.code);
      if (!data) throw conflict();
    },
    async claim(conversation: Conversation, messages: SavedMessage[], revision: number, draftVersion: number, runId: string, clearDraft: boolean) {
      if (conversationBusy(conversation) || conversation.revision !== revision
        || conversation.draft_version !== draftVersion
        || !conversation.messages.every((message, index) =>
          message.id === messages[index]?.id && message.role === messages[index]?.role
          && message.content === messages[index]?.content)) {
        throw conflict();
      }
      const title = conversation.messages.length === 0 && conversation.title === "New chat"
        ? messages.find((message) => message.role === "user")?.content.replace(/\s+/g, " ").trim()
          .slice(0, 80).replace(/[\uD800-\uDBFF]$/, "") || "New chat"
        : conversation.title;
      const { data, error } = await table().update({
        messages, title, draft: clearDraft ? "" : conversation.draft,
        draft_version: draftVersion + (clearDraft ? 1 : 0), revision: revision + 1,
        status: "streaming", run_id: runId, run_expires_at: new Date(Date.now() + 150_000).toISOString(),
      }).eq("user_id", userId).eq("id", conversation.id).eq("revision", revision)
        .eq("draft_version", draftVersion).or(idleFilter()).select("*").maybeSingle();
      return parsed(data, error);
    },
    async checkpoint(id: string, runId: string, messages: SavedMessage[], status: Conversation["status"]) {
      const { data, error } = await table().update({
        messages, status,
        ...(status === "streaming" ? {} : { run_id: null, run_expires_at: null }),
      }).eq("user_id", userId).eq("id", id).eq("run_id", runId).select("id").maybeSingle();
      if (error) throw failure(error.code);
      if (!data) throw conflict();
    },
  };
}
