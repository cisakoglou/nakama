import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./start/route";
import { GET } from "./callback/route";
import { HevyOAuthError } from "@/lib/hevy-oauth";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), begin: vi.fn(), complete: vi.fn(), disconnect: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireBetaUser: mocks.auth }));
vi.mock("@/lib/chat-lifecycle", () => ({ disconnectChats: mocks.disconnect }));
vi.mock("@/lib/hevy-oauth", async original => ({
  ...await original<typeof import("@/lib/hevy-oauth")>(), beginHevyOAuth: mocks.begin, completeHevyOAuth: mocks.complete,
}));

const owner = "00000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_ORIGIN", "https://nakama.test");
  mocks.auth.mockResolvedValue({
    ok: true, user: { id: owner },
    session: {
      json: (body: unknown, status = 200) => NextResponse.json(body, { status }),
      respond: (response: NextResponse) => response,
    },
  });
  mocks.begin.mockResolvedValue({ authorizationUrl: "https://hevy.com/oauth/authorize?state=public-state", browser: "private-browser-binding" });
  mocks.complete.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("OAuth routes", () => {
  it("uses the trusted origin behind the proxy, binds to the signed-in user and sets a narrow HttpOnly cookie", async () => {
    const response = await POST(new NextRequest("http://0.0.0.0:3002/api/hevy/oauth/start?returnTo=https://evil.test", {
      method: "POST", headers: { origin: "https://nakama.test" },
    }));
    expect(mocks.begin).toHaveBeenCalledWith(owner, "https://nakama.test");
    expect(await response.json()).toEqual({ authorization_url: "https://hevy.com/oauth/authorize?state=public-state" });
    expect(response.cookies.get("hevy_oauth_browser")).toMatchObject({
      value: "private-browser-binding", path: "/api/hevy/oauth", httpOnly: true, secure: true, sameSite: "lax", maxAge: 600,
    });
  });

  it("rejects a cross-origin start before accessing session state", async () => {
    const response = await POST(new NextRequest("https://nakama.test/api/hevy/oauth/start", {
      method: "POST", headers: { origin: "https://evil.test" },
    }));
    expect(response.status).toBe(403);
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it("permits local development without a Secure-only cookie", async () => {
    vi.stubEnv("APP_ORIGIN", "http://localhost:3002");
    const response = await POST(new NextRequest("http://localhost:3002/api/hevy/oauth/start", {
      method: "POST", headers: { origin: "http://localhost:3002" },
    }));
    expect(response.cookies.get("hevy_oauth_browser")?.secure).toBe(false);
  });

  it("returns start errors without setting a browser binding or leaking credentials", async () => {
    mocks.begin.mockRejectedValue(new HevyOAuthError("migration_required", 409, "Your connection is unchanged."));
    const response = await POST(new NextRequest("https://nakama.test/api/hevy/oauth/start", {
      method: "POST", headers: { origin: "https://nakama.test" },
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "migration_required", error: "Your connection is unchanged." });
    expect(response.cookies.get("hevy_oauth_browser")).toBeUndefined();
  });

  it("returns success to the fixed trusted root and discards provider query parameters", async () => {
    const response = await GET(new NextRequest("http://0.0.0.0:3002/api/hevy/oauth/callback?state=test-state&code=test-code&returnTo=https://evil.test", {
      headers: { cookie: "hevy_oauth_browser=browser-value" },
    }));
    expect(mocks.complete).toHaveBeenCalledWith(owner, { state: "test-state", browser: "browser-value", code: "test-code", error: null });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://nakama.test/?hevy_oauth=connected");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.cookies.get("hevy_oauth_browser")?.maxAge).toBe(0);
    expect(mocks.disconnect).toHaveBeenCalledWith(owner);
  });

  it("redirects callback errors to the app with only the enum code, clears the binding and leaves active chats untouched", async () => {
    mocks.complete.mockRejectedValue(new HevyOAuthError("invalid_state", 400, "Start again."));
    const response = await GET(new NextRequest("https://nakama.test/api/hevy/oauth/callback?state=used&code=secret-code"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://nakama.test/?hevy_oauth=error&code=invalid_state");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.cookies.get("hevy_oauth_browser")?.maxAge).toBe(0);
    expect(mocks.disconnect).not.toHaveBeenCalled();
  });

  it.each([
    "access_denied", "invalid_state", "account_in_use", "account_mismatch", "connection_changed", "migration_required",
    "missing_scope", "not_eligible", "provider_unavailable", "configuration_unavailable", "reconnect_required", "refresh_busy",
  ] as const)("passes the contract code %s through", async (code) => {
    mocks.complete.mockRejectedValue(new HevyOAuthError(code, 400, "Provider said something private."));
    const location = (await GET(new NextRequest("https://nakama.test/api/hevy/oauth/callback?state=s&code=c"))).headers.get("location")!;
    expect(location).toBe(`https://nakama.test/?hevy_oauth=error&code=${code}`);
  });

  it("maps any other connection failure to code=unknown without provider text", async () => {
    const { HevyConnectionError } = await import("@/lib/hevy-connection");
    mocks.complete.mockRejectedValue(new HevyConnectionError(503, "Database code XX000 detail"));
    const response = await GET(new NextRequest("https://nakama.test/api/hevy/oauth/callback?state=s&code=secret-code"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://nakama.test/?hevy_oauth=error&code=unknown");
  });

  it("rejects duplicated callback parameters without consuming state", async () => {
    const response = await GET(new NextRequest("https://nakama.test/api/hevy/oauth/callback?state=one&state=two&code=secret"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://nakama.test/?hevy_oauth=error&code=invalid_state");
    expect(response.headers.get("location")).not.toContain("secret");
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it.each([[401, "signed_out"], [403, "signed_out"], [503, "unknown"]] as const)(
    "does not start or complete OAuth without verified beta access (%s -> %s)", async (status, code) => {
      const denied = NextResponse.json({ error: "Access unavailable." }, { status });
      denied.cookies.set("sb-session", "", { maxAge: 0 });
      mocks.auth.mockResolvedValue({ ok: false, response: denied });
      expect((await POST(new NextRequest("https://nakama.test/api/hevy/oauth/start", {
        method: "POST", headers: { origin: "https://nakama.test" },
      }))).status).toBe(status);
      // The callback lands in a browser: redirect back into the app instead of showing JSON.
      const response = await GET(new NextRequest("https://nakama.test/api/hevy/oauth/callback?state=s&code=secret"));
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(`https://nakama.test/?hevy_oauth=error&code=${code}`);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(response.cookies.get("hevy_oauth_browser")?.maxAge).toBe(0);
      // Session cookie changes from the auth check are kept.
      expect(response.cookies.get("sb-session")?.maxAge).toBe(0);
      expect(mocks.begin).not.toHaveBeenCalled();
      expect(mocks.complete).not.toHaveBeenCalled();
    },
  );
});
