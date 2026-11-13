import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, PUT } from "./route";

const mocks = vi.hoisted(() => ({ access: vi.fn(), create: vi.fn(), revoke: vi.fn(), status: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireBetaUser: mocks.access }));
vi.mock("@/lib/hevy-webhook", async (original) => ({
  ...await original<typeof import("@/lib/hevy-webhook")>(),
  createWebhookToken: mocks.create, revokeWebhookToken: mocks.revoke, webhookTokenStatus: mocks.status,
}));

const userId = "00000000-0000-4000-8000-000000000001";
const token = `nkwh_${"A".repeat(43)}`;

function request(method: string, origin: string | null = "https://nakama.test") {
  return new NextRequest("https://nakama.test/api/hevy/webhook-token", {
    method, headers: origin ? { origin } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_ORIGIN", "https://nakama.test");
  mocks.access.mockResolvedValue({
    ok: true, user: { id: userId, email: "one@example.test" },
    session: { json: (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } }) },
  });
});

describe("webhook token settings", () => {
  it("returns the token once as a complete Authorization header with the configured webhook URL", async () => {
    mocks.create.mockResolvedValue(token);
    const response = await PUT(request("PUT"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      webhook: { configured: true, url: "https://nakama.test/api/hevy/webhook", authorization: `Bearer ${token}` },
    });
    expect(mocks.create).toHaveBeenCalledWith(userId);
  });

  it("never returns the token from status checks", async () => {
    mocks.status.mockResolvedValue({ configured: true, created_at: "2026-11-13T00:00:00Z" });
    const body = await (await GET(request("GET", null))).json();
    expect(body).toEqual({ webhook: { configured: true, created_at: "2026-11-13T00:00:00Z", url: "https://nakama.test/api/hevy/webhook" } });
  });

  it("requires a Hevy connection before creating a token", async () => {
    mocks.create.mockResolvedValue(null);
    expect((await PUT(request("PUT"))).status).toBe(409);
  });

  it.each([["PUT", PUT], ["DELETE", DELETE]] as const)("rejects cross-site %s requests", async (method, handler) => {
    const response = await handler(request(method, "https://evil.test"));
    expect(response.status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
  });

  it("revokes the token for the signed-in user only", async () => {
    expect((await DELETE(request("DELETE"))).status).toBe(200);
    expect(mocks.revoke).toHaveBeenCalledWith(userId);
  });

  it("passes through sign-in failures", async () => {
    mocks.access.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Please sign in." }, { status: 401 }) });
    expect((await PUT(request("PUT"))).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
