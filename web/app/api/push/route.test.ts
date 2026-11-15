import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, POST } from "./route";

const mocks = vi.hoisted(() => ({ access: vi.fn(), count: vi.fn(), save: vi.fn(), remove: vi.fn(), config: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireBetaUser: mocks.access }));
vi.mock("@/lib/push", async (original) => ({
  ...await original<typeof import("@/lib/push")>(),
  pushConfig: mocks.config, pushSubscriptionCount: mocks.count,
  savePushSubscription: mocks.save, deletePushSubscription: mocks.remove,
}));

import { PushStorageError } from "@/lib/push";

const userId = "00000000-0000-4000-8000-000000000001";
const publicKey = `B${"A".repeat(86)}`;
const subscription = { endpoint: "https://push.example.test/send/abc", expirationTime: null, keys: { p256dh: "BKey", auth: "secret" } };

function request(method: string, body?: unknown, origin: string | null = "https://nakama.test") {
  return new NextRequest("https://nakama.test/api/push", {
    method, headers: { ...origin ? { origin } : {}, "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_ORIGIN", "https://nakama.test");
  mocks.config.mockReturnValue({ publicKey, privateKey: "p".repeat(43), subject: "mailto:ops@example.test" });
  mocks.count.mockResolvedValue(1);
  mocks.access.mockResolvedValue({
    ok: true, user: { id: userId, email: "one@example.test" },
    session: { json: (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } }) },
  });
});

describe("push settings", () => {
  it("returns the public key and subscription count, never private configuration", async () => {
    const response = await GET(request("GET", undefined, null));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ push: { available: true, public_key: publicKey, subscriptions: 1 } });
    expect(mocks.count).toHaveBeenCalledWith(userId);
  });

  it("reports push as unavailable when VAPID is not configured", async () => {
    mocks.config.mockReturnValue(null);
    expect(await (await GET(request("GET"))).json()).toEqual({ push: { available: false, public_key: null, subscriptions: 0 } });
    expect((await POST(request("POST", subscription))).status).toBe(503);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("saves a valid subscription for the signed-in user", async () => {
    const response = await POST(request("POST", subscription));
    expect(response.status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith(userId, { endpoint: subscription.endpoint, keys: subscription.keys });
  });

  it.each([
    ["an http endpoint", { ...subscription, endpoint: "http://push.example.test/send" }],
    ["missing keys", { endpoint: subscription.endpoint }],
    ["an oversized key", { ...subscription, keys: { p256dh: "x".repeat(300), auth: "secret" } }],
    ["an oversized body", { ...subscription, padding: "x".repeat(5_000) }],
    ["invalid JSON", "{"],
  ])("rejects %s", async (_, body) => {
    expect((await POST(request("POST", body))).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("unsubscribes by endpoint for the signed-in user only", async () => {
    expect((await DELETE(request("DELETE", { endpoint: subscription.endpoint }))).status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith(userId, subscription.endpoint);
    expect((await DELETE(request("DELETE", { endpoint: "not a url" }))).status).toBe(400);
  });

  it.each([["POST", POST], ["DELETE", DELETE]] as const)("rejects cross-site %s requests", async (method, handler) => {
    const response = await handler(request(method, subscription, "https://evil.test"));
    expect(response.status).toBe(403);
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("passes through sign-in failures", async () => {
    mocks.access.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Please sign in." }, { status: 401 }) });
    expect((await GET(request("GET"))).status).toBe(401);
    expect((await POST(request("POST", subscription))).status).toBe(401);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("maps storage failures to 503", async () => {
    mocks.save.mockRejectedValue(new PushStorageError("down"));
    expect((await POST(request("POST", subscription))).status).toBe(503);
  });
});
