import { NextRequest, NextResponse } from "next/server";
import { AuthApiError, AuthSessionMissingError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { HevyConnectionError } from "@/lib/hevy-connection";
import { POST } from "./route";
import { GET } from "../account/route";
import { PUT } from "../profile/route";

const mocks = vi.hoisted(() => ({
  createRequestClient: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  upsert: vi.fn(),
  single: vi.fn(),
  getMcp: vi.fn(),
  loadConnection: vi.fn(),
  streamText: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createRequestClient: mocks.createRequestClient }));
vi.mock("@/lib/mcp", () => ({ getMcp: mocks.getMcp }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/user-mcp", () => ({ createUserMcp: mocks.getMcp }));
vi.mock("@/lib/hevy-connection", async (original) => ({
  ...await original<typeof import("@/lib/hevy-connection")>(),
  loadHevyConnection: mocks.loadConnection,
}));
vi.mock("ai", () => ({ streamText: mocks.streamText }));

const user = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "one@example.test",
  email_confirmed_at: "2026-10-18T00:00:00Z",
};
const preferences = {
  goal: "strength", experience: "beginner", training_days: 3, equipment: "gym", units: "kg",
};
const profile = {
  ...preferences, user_id: user.id,
  created_at: "2026-10-18T00:00:00Z", updated_at: "2026-10-18T00:00:00Z",
};
const query = {
  select: mocks.select, eq: mocks.eq, maybeSingle: mocks.maybeSingle,
  upsert: mocks.upsert, single: mocks.single,
};

function request(path = "chat", body = "not JSON", origin: string | null = "https://nakama.test") {
  const headers = new Headers({ "x-app-password": "old-shared-password" });
  if (origin) headers.set("origin", origin);
  return new NextRequest(`https://nakama.test/api/${path}`, {
    method: path === "account" ? "GET" : path === "profile" ? "PUT" : "POST",
    headers,
    ...(path === "account" ? {} : { body }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.getUser.mockResolvedValue({ data: { user }, error: null });
  vi.stubEnv("ANTHROPIC_API_KEY", "test-provider-key");
  mocks.rpc.mockImplementation((name: string) => Promise.resolve({
    data: name === "has_beta_access" ? true : { connected: false }, error: null,
  }));
  mocks.loadConnection.mockRejectedValue(new HevyConnectionError(409, "Connect your own Hevy account before starting coaching."));
  mocks.from.mockReturnValue(query);
  mocks.select.mockReturnValue(query);
  mocks.eq.mockReturnValue(query);
  mocks.upsert.mockReturnValue(query);
  mocks.maybeSingle.mockResolvedValue({ data: profile, error: null });
  mocks.single.mockResolvedValue({ data: profile, error: null });
  mocks.createRequestClient.mockReturnValue({
    client: { auth: { getUser: mocks.getUser }, rpc: mocks.rpc, from: mocks.from },
    json: (body: unknown, status = 200) => NextResponse.json(body, {
      status, headers: { "Cache-Control": "private, no-store" },
    }),
  });
});

afterEach(() => {
  expect(mocks.getMcp).not.toHaveBeenCalled();
  expect(mocks.streamText).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("private API authentication", () => {
  it.each([POST, PUT])("accepts the public origin behind a reverse proxy without bypassing authentication (%#)", async (handler) => {
    vi.stubEnv("APP_ORIGIN", "https://nakama.test");
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() });
    const response = await handler(new NextRequest("http://0.0.0.0:3002/api/test", {
      method: handler === PUT ? "PUT" : "POST",
      headers: { origin: "https://nakama.test" },
      body: "{}",
    }));
    expect(response.status).toBe(401);
  });

  it("does not trust forwarded host headers to authorize another origin", async () => {
    vi.stubEnv("APP_ORIGIN", "https://nakama.test");
    const response = await POST(new NextRequest("http://0.0.0.0:3002/api/chat", {
      method: "POST",
      headers: { origin: "https://other.test", "x-forwarded-host": "other.test" },
      body: "{}",
    }));
    expect(response.status).toBe(403);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("fails closed without Supabase configuration", async () => {
    mocks.createRequestClient.mockImplementation(() => { throw new SupabaseConfigurationError("Sign-in is not configured."); });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it.each([POST, GET, PUT])("does not accept the legacy shared password (%#)", async (handler) => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() });
    const path = handler === GET ? "account" : handler === PUT ? "profile" : "chat";
    const response = await handler(request(path));
    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("rejects an expired session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new AuthApiError("Expired", 401, "bad_jwt") });
    expect((await POST(request())).status).toBe(401);
  });

  it("reports authentication outages instead of treating them as sign-outs", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new AuthApiError("Unavailable", 503, "unexpected_failure") });
    expect((await GET(request("account"))).status).toBe(503);
    expect(console.error).toHaveBeenCalled();
  });

  it("requires a verified email", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { ...user, email_confirmed_at: null } }, error: null });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([false, null])("rejects missing or revoked invitations (%j)", async (invited) => {
    mocks.rpc.mockResolvedValue({ data: invited, error: null });
    expect((await GET(request("account"))).status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("reports invitation lookup failures", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "57014" } });
    expect((await GET(request("account"))).status).toBe(503);
    expect(console.error).toHaveBeenCalled();
  });

  it("keeps coaching disconnected for an invited account", async () => {
    const response = await POST(request("chat", JSON.stringify({
      messages: [{ id: "one", role: "user", parts: [{ type: "text", text: "Hello" }] }],
    })));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: expect.stringContaining("Connect your own Hevy") });
    expect(mocks.rpc).toHaveBeenCalledWith("has_beta_access");
  });
});

describe("private training profiles", () => {
  it("loads only the server-verified user's profile", async () => {
    const response = await GET(request("account"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: { id: user.id, email: user.email }, profile, connection: { connected: false } });
    expect(mocks.eq).toHaveBeenCalledWith("user_id", user.id);
  });

  it("returns no profile for an invited first-time user", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await (await GET(request("account"))).json()).toEqual({
      user: { id: user.id, email: user.email }, profile: null, connection: { connected: false },
    });
  });

  it("binds saved preferences to the verified account", async () => {
    const response = await PUT(request("profile", JSON.stringify(preferences)));
    expect(response.status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledWith({ ...preferences, user_id: user.id }, { onConflict: "user_id" });
    expect(await response.json()).toEqual({ profile });
  });

  it.each([
    { ...preferences, user_id: "00000000-0000-4000-8000-000000000002" },
    { ...preferences, training_days: 0 },
    { ...preferences, training_days: 8 },
    { ...preferences, training_days: 2.5 },
    { ...preferences, goal: "invalid" },
    { ...preferences, units: "stone" },
  ])("rejects forged identity and invalid preferences (%#)", async (body) => {
    expect((await PUT(request("profile", JSON.stringify(body)))).status).toBe(400);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    expect((await PUT(request("profile"))).status).toBe(400);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it.each([null, "https://another-app.test"])("rejects a missing or foreign origin (%j)", async (origin) => {
    expect((await PUT(request("profile", JSON.stringify(preferences), origin))).status).toBe(403);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("does not claim a failed save succeeded", async () => {
    mocks.single.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect((await PUT(request("profile", JSON.stringify(preferences)))).status).toBe(503);
    expect(console.error).toHaveBeenCalled();
  });

  it("does not turn a failed lookup into a new-user profile", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { code: "57014" } });
    expect((await GET(request("account"))).status).toBe(503);
    expect(console.error).toHaveBeenCalled();
  });
});
