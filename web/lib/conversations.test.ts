import { beforeEach, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { conversationStore } from "./conversations";
import type { Database } from "./supabase/database";
import type { Conversation } from "./conversation-types";

vi.mock("server-only", () => ({}));
const query = {
  select: vi.fn(), eq: vi.fn(), or: vi.fn(), update: vi.fn(), delete: vi.fn(), maybeSingle: vi.fn(),
};
const client = createClient<Database>("https://supabase.example.test", "sb_publishable_test", {
  auth: { persistSession: false, autoRefreshToken: false },
});
const id = "00000000-0000-4000-8000-000000000001";
const chat: Conversation = {
  id, user_id: id, title: "New chat", messages: [], draft: "Keep my unsent draft", draft_version: 2,
  revision: 3, status: "ready", run_id: null, run_expires_at: null,
  created_at: "2026-11-04T00:00:00Z", updated_at: "2026-11-04T00:00:00Z",
};
const store = conversationStore(client, id);

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(client, "from").mockReturnValue(query as ReturnType<typeof client.from>);
  for (const method of [query.select, query.eq, query.or, query.update, query.delete]) method.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: chat, error: null });
});

it("always scopes database access to the verified owner", async () => {
  await store.load(id);
  expect(query.eq).toHaveBeenCalledWith("user_id", id);
  expect(query.eq).toHaveBeenCalledWith("id", id);
  query.maybeSingle.mockResolvedValue({ data: null, error: null });
  await expect(store.load(id)).rejects.toMatchObject({ status: 404 });
});

it("atomically claims the expected transcript and draft versions", async () => {
  await store.claim(chat, [{ id: "user", role: "user", content: "Review my squat" }], 3, 2, id, true);
  expect(query.eq).toHaveBeenCalledWith("revision", 3);
  expect(query.eq).toHaveBeenCalledWith("draft_version", 2);
  expect(query.or).toHaveBeenCalledWith(expect.stringContaining("run_expires_at.lte."));
  expect(query.update).toHaveBeenCalledWith(expect.objectContaining({
    revision: 4, draft_version: 3, draft: "", status: "streaming", run_id: id, title: "Review my squat",
  }));
});

it("preserves an unsent draft while continuing a tool approval", async () => {
  await store.claim(chat, [], 3, 2, id, false);
  expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ draft: chat.draft, draft_version: 2 }));
});

it("does not split a Unicode character at the automatic title limit", async () => {
  await store.claim(chat, [{ id: "user", role: "user", content: "x".repeat(79) + "\u{1f4aa}" }], 3, 2, id, true);
  expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ title: "x".repeat(79) }));
});

it("refuses stale versions, active streams, or a replaced history before writing", async () => {
  await expect(store.claim(chat, [], 2, 2, id, true)).rejects.toMatchObject({ status: 409 });
  await expect(store.claim({ ...chat, status: "streaming", run_expires_at: new Date(Date.now() + 10000).toISOString() }, [], 3, 2, id, true))
    .rejects.toMatchObject({ status: 409 });
  await expect(store.claim({ ...chat, messages: [{ id: "old", role: "user", content: "Saved text" }] }, [], 3, 2, id, true))
    .rejects.toMatchObject({ status: 409 });
  expect(query.update).not.toHaveBeenCalled();
});

it("does not overwrite a newer draft or resurrect a deleted stream", async () => {
  query.maybeSingle.mockResolvedValue({ data: null, error: null });
  await expect(store.patch(id, { draft: "stale", draftVersion: 1 })).rejects.toMatchObject({ status: 409 });
  expect(query.eq).toHaveBeenCalledWith("draft_version", 1);
  await expect(store.checkpoint(id, id, [], "ready")).rejects.toMatchObject({ status: 409 });
  expect(query.eq).toHaveBeenCalledWith("run_id", id);
});
