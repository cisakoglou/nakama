import { NextRequest, NextResponse } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { GET as LOAD, PATCH, DELETE } from "./[id]/route";
import { ConversationError } from "@/lib/conversations";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), store: vi.fn(), list: vi.fn(), create: vi.fn(), load: vi.fn(), patch: vi.fn(), remove: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireBetaUser: mocks.auth }));
vi.mock("@/lib/conversations", async (original) => ({
  ...await original<typeof import("@/lib/conversations")>(), conversationStore: mocks.store,
}));
const id = "00000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ id }) };
function request(method = "GET", body?: unknown, origin = "https://nakama.test") {
  return new NextRequest(`https://nakama.test/api/conversations/${id}`, {
    method, headers: { origin }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({
    ok: true, user: { id },
    session: { client: "verified-client", json: (body: unknown, status = 200) => NextResponse.json(body, { status }) },
  });
  mocks.store.mockReturnValue({ list: mocks.list, create: mocks.create, load: mocks.load, patch: mocks.patch, remove: mocks.remove });
  mocks.list.mockResolvedValue({ conversations: [], hasMore: false });
  mocks.create.mockResolvedValue({ id });
  mocks.load.mockResolvedValue({ id });
  mocks.patch.mockResolvedValue({ id });
  mocks.remove.mockResolvedValue(undefined);
});

it("lists and creates only for the server-verified account", async () => {
  expect((await GET(request())).status).toBe(200);
  expect(mocks.list).toHaveBeenCalledWith(0);
  expect((await POST(request("POST", { user_id: "forged" }))).status).toBe(201);
  expect(mocks.store.mock.calls.every((call) => call[1] === id)).toBe(true);
  expect(mocks.create).toHaveBeenCalledWith();
});

it.each(["POST", "PATCH", "DELETE"])("rejects foreign origins before authentication (%s)", async (method) => {
  const handler = method === "POST" ? POST : method === "PATCH" ? PATCH : DELETE;
  expect((await handler(request(method, {}, "https://other.test"), context)).status).toBe(403);
  expect(mocks.auth).not.toHaveBeenCalled();
});

it("does not expose chat endpoints to signed-out users", async () => {
  mocks.auth.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Please sign in." }, { status: 401 }) });
  for (const handler of [GET, POST, LOAD, PATCH, DELETE]) {
    expect((await handler(request(), context)).status).toBe(401);
  }
  expect(mocks.store).not.toHaveBeenCalled();
});

it("validates rename, draft versions, and deletion without accepting forged owners", async () => {
  expect((await PATCH(request("PATCH", { title: "Squat progress" }), context)).status).toBe(200);
  expect(mocks.patch).toHaveBeenCalledWith(id, { title: "Squat progress" });
  expect((await PATCH(request("PATCH", { draft: "Next session?", draftVersion: 2 }), context)).status).toBe(200);
  expect((await PATCH(request("PATCH", { title: "Forged", user_id: id }), context)).status).toBe(400);
  expect((await PATCH(request("PATCH", { draft: "Missing version" }), context)).status).toBe(400);
  expect((await DELETE(request("DELETE", { revision: 3 }), context)).status).toBe(200);
  expect(mocks.remove).toHaveBeenCalledWith(id, 3);
});

it("accepts a full-length Unicode draft within the advertised character limit", async () => {
  const draft = "\u20ac".repeat(8000);
  expect((await PATCH(request("PATCH", { draft, draftVersion: 0 }), context)).status).toBe(200);
  expect(mocks.patch).toHaveBeenCalledWith(id, { draft, draftVersion: 0 });
});

it("returns not-found for a missing or foreign conversation without leaking it", async () => {
  mocks.load.mockRejectedValue(new ConversationError(404, "This chat was not found."));
  const response = await LOAD(request(), context);
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "This chat was not found." });
});

it("surfaces stale drafts and unavailable storage instead of claiming success", async () => {
  mocks.patch.mockRejectedValue(new ConversationError(409, "Chat changed elsewhere"));
  expect((await PATCH(request("PATCH", { draft: "new", draftVersion: 0 }), context)).status).toBe(409);
  mocks.list.mockRejectedValue(new ConversationError(503, "Chat storage unavailable"));
  expect((await GET(request())).status).toBe(503);
});
