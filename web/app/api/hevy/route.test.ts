import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PUT, DELETE } from "./route";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), save: vi.fn(), remove: vi.fn(), disconnect: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireBetaUser: mocks.auth }));
vi.mock("@/lib/chat-lifecycle", () => ({ disconnectChats: mocks.disconnect }));
vi.mock("@/lib/hevy-connection", async (original) => ({
  ...await original<typeof import("@/lib/hevy-connection")>(),
  saveHevyConnection: mocks.save, deleteHevyConnection: mocks.remove,
}));

const owner = "00000000-0000-4000-8000-000000000001";
function request(body: unknown = { api_key: "personal-key" }, origin = "https://nakama.test") {
  return new NextRequest("https://nakama.test/api/hevy", {
    method: "PUT", headers: { origin }, body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({
    ok: true, user: { id: owner, email: "one@example.test" },
    session: { json: (body: unknown, status = 200) => NextResponse.json(body, { status }) },
  });
  mocks.save.mockResolvedValue({ connected: true, revision: owner, connected_at: "2026-10-18T00:00:00Z" });
  mocks.remove.mockResolvedValue(undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it.each([PUT, DELETE])("accepts the configured public origin behind a reverse proxy (%#)", async (handler) => {
  vi.stubEnv("APP_ORIGIN", "https://nakama.test");
  mocks.auth.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Please sign in." }, { status: 401 }) });
  const response = await handler(new NextRequest("http://0.0.0.0:3002/api/hevy", {
    method: handler === DELETE ? "DELETE" : "PUT",
    headers: { origin: "https://nakama.test" },
  }));
  expect(response.status).toBe(401);
  expect(mocks.auth).toHaveBeenCalled();
});

it("binds new keys to the verified account and returns no credential", async () => {
  const response = await PUT(request());
  expect(mocks.save).toHaveBeenCalledWith(owner, "personal-key");
  expect(mocks.disconnect).toHaveBeenCalledWith(owner);
  expect(response.status).toBe(200);
  expect(await response.text()).not.toContain("personal-key");
});

it("rejects a forged user ID", async () => {
  expect((await PUT(request({ api_key: "personal-key", user_id: "someone-else" }))).status).toBe(400);
  expect(mocks.save).not.toHaveBeenCalled();
});

it("disconnects only the verified account", async () => {
  expect((await DELETE(request())).status).toBe(200);
  expect(mocks.remove).toHaveBeenCalledWith(owner);
  expect(mocks.disconnect).toHaveBeenCalledWith(owner);
});

it.each([PUT, DELETE])("rejects unauthenticated connection changes (%#)", async (handler) => {
  mocks.auth.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Please sign in." }, { status: 401 }) });
  expect((await handler(request())).status).toBe(401);
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.remove).not.toHaveBeenCalled();
});

it.each([PUT, DELETE])("rejects cross-origin connection changes (%#)", async (handler) => {
  expect((await handler(request({}, "https://other.test"))).status).toBe(403);
  expect(mocks.auth).not.toHaveBeenCalled();
});
