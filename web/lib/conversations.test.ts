import { beforeEach, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { PGlite } from "@electric-sql/pglite";
import { conversationStore } from "./conversations";
import type { Database } from "./supabase/database";
import type { Conversation } from "./conversation-types";

vi.mock("server-only", () => ({}));
const query = {
  select: vi.fn(), eq: vi.fn(), or: vi.fn(), update: vi.fn(), delete: vi.fn(), maybeSingle: vi.fn(),
  filter: vi.fn(), order: vi.fn(), range: vi.fn(),
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
const summary = { ...chat, first_message_id: null };

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(client, "from").mockReturnValue(query as ReturnType<typeof client.from>);
  for (const method of [query.select, query.eq, query.or, query.update, query.delete, query.filter, query.order]) method.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: chat, error: null });
});

it("filters literal title matches before account-scoped pagination", async () => {
  query.range.mockResolvedValue({ data: Array.from({ length: 21 }, () => summary), error: null });
  const page = await store.list(2, "Squat.* (50%_)+[a]?\\");
  expect(query.eq).toHaveBeenCalledWith("user_id", id);
  expect(query.filter).toHaveBeenCalledWith("title", "imatch", "Squat\\.\\* \\(50%_\\)\\+\\[a\\]\\?\\\\");
  expect(query.filter.mock.invocationCallOrder[0]).toBeLessThan(query.range.mock.invocationCallOrder[0]);
  expect(query.range).toHaveBeenCalledWith(40, 60);
  expect(page.conversations).toHaveLength(20);
  expect(page.hasMore).toBe(true);
});

it("preserves unfiltered history and surfaces search storage failures", async () => {
  query.range.mockResolvedValue({ data: [summary], error: null });
  expect(await store.list(0)).toMatchObject({ hasMore: false });
  expect(query.filter).not.toHaveBeenCalled();
  query.range.mockResolvedValue({ data: null, error: { code: "unavailable" } });
  await expect(store.list(0, "Squat")).rejects.toMatchObject({ status: 503 });
});

it("executes literal case-insensitive searches and pagination against PostgreSQL", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table chat_conversations (
      id uuid, user_id uuid, title text, status text, created_at timestamptz, updated_at timestamptz,
      messages jsonb default '[]'
    )`);
    const literal = "Squat.* (50%_)+[a]?\\";
    await db.query(`insert into chat_conversations (id, user_id, title, status, created_at, updated_at)
      select md5(i::text)::uuid, $1::uuid, $2::text, 'ready', now(), now()
      from generate_series(1, 45) i`, [id, literal]);
    await db.query(`insert into chat_conversations (id, user_id, title, status, created_at, updated_at) values
      (gen_random_uuid(), gen_random_uuid(), $1, 'ready', now(), now()),
      (gen_random_uuid(), $2, 'Squat ordinary chat', 'ready', now(), now())`, [literal, id]);
    await db.query("update chat_conversations set messages = $1::jsonb where title = $2",
      [JSON.stringify([{ id: "workout-report-example", role: "assistant", content: "Report" }]), literal]);
    const databaseClient = createClient<Database>("https://supabase.example.test", "sb_publishable_test", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (input) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        expect(url.searchParams.get("user_id")).toBe(`eq.${id}`);
        expect(url.searchParams.get("select")).toContain("first_message_id:messages->0->>id");
        const filter = url.searchParams.get("title");
        if (!filter) throw new Error("Missing title filter.");
        expect(filter).toMatch(/^imatch\./);
        const data = await db.query(`select *, messages->0->>'id' as first_message_id from chat_conversations
          where user_id = $1 and title ~* $2 order by updated_at desc, id desc limit $3 offset $4`,
        [id, filter.slice(7), Number(url.searchParams.get("limit")), Number(url.searchParams.get("offset"))]);
        return Response.json(data.rows);
      } },
    });
    const searched = conversationStore(databaseClient, id);
    for (const term of ["sQUAT.*", "(50%_)", "+[a]?\\"]) {
      const firstPage = await searched.list(0, term);
      const lastPage = await searched.list(2, term);
      expect(firstPage.conversations).toHaveLength(20);
      expect(firstPage.conversations.every((chat) => chat.first_message_id === "workout-report-example")).toBe(true);
      expect(firstPage.hasMore).toBe(true);
      expect(lastPage.conversations).toHaveLength(5);
      expect(lastPage.hasMore).toBe(false);
      expect([...firstPage.conversations, ...lastPage.conversations].every((chat) => chat.title === literal)).toBe(true);
    }
    expect(await searched.list(0, "missing")).toEqual({ conversations: [], hasMore: false });
  } finally { await db.close(); }
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
