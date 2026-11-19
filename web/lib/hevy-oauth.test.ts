import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginHevyOAuth, completeHevyOAuth, hevyOAuthCallback, loadHevyCredentials } from "./hevy-oauth";
import { decryptHevyKey, encryptHevyKey } from "./hevy-connection";
import type { HevyConnectionRow } from "./supabase/database";
import type { Database } from "./supabase/database";
import { createClient } from "@supabase/supabase-js";
import { drainWorkoutReports } from "./workout-report-worker";

const mocks = vi.hoisted(() => ({ storage: vi.fn(), rpc: vi.fn(), fetch: vi.fn(), from: vi.fn(), maybeSingle: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/hevy-connection", async original => ({
  ...await original<typeof import("@/lib/hevy-connection")>(), storage: mocks.storage,
}));

const owner = "00000000-0000-4000-8000-000000000001";
const provider = "00000000-0000-4000-8000-000000000002";
const revision = "00000000-0000-4000-8000-000000000003";
const state = "a".repeat(43);
const browser = "b".repeat(43);
const callback = { state, browser, code: "authorization-code", error: null };
const pair = { access_token: "new-access", refresh_token: "new-refresh", token_type: "Bearer", expires_in: 3600 };
let connection: HevyConnectionRow | null;

function row(overrides: Partial<HevyConnectionRow> = {}): HevyConnectionRow {
  return {
    user_id: owner, encrypted_key: null, revision, updated_at: "2026-11-19T00:00:00Z",
    credential_method: "oauth", encrypted_oauth: encryptHevyKey(owner, JSON.stringify({
      access_token: "old-access", refresh_token: "old-refresh",
    })),
    hevy_user_id: provider, hevy_username: "lifter", access_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    oauth_status: "active", token_version: 0, refresh_attempt_id: null, refresh_started_at: null, ...overrides,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("HEVY_OAUTH_CLIENT_ID", "test-client");
  vi.stubEnv("HEVY_OAUTH_CLIENT_SECRET", "test-secret");
  vi.stubEnv("HEVY_CREDENTIAL_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  connection = row();
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: mocks.maybeSingle };
  mocks.from.mockReturnValue(query);
  mocks.maybeSingle.mockImplementation(async () => ({ data: connection ? { ...connection } : null, error: null }));
  mocks.storage.mockReturnValue({ from: mocks.from, rpc: mocks.rpc });
  mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "reserve_hevy_request") return { data: 0, error: null };
    if (name === "begin_hevy_oauth") return { data: "started", error: null };
    if (name === "consume_hevy_oauth_state") return { data: true, error: null };
    if (name === "complete_hevy_oauth") return { data: "saved", error: null };
    if (name === "claim_hevy_oauth_refresh") {
      if (connection?.refresh_attempt_id) return { data: "busy", error: null };
      if (connection) connection.refresh_attempt_id = String(args.p_attempt_id);
      return { data: "claimed", error: null };
    }
    if (name === "finish_hevy_oauth_refresh") {
      if (connection) connection = {
        ...connection, encrypted_oauth: String(args.p_encrypted_oauth),
        access_expires_at: String(args.p_expires_at), token_version: connection.token_version + 1,
        refresh_attempt_id: null, refresh_started_at: null,
      };
      return { data: true, error: null };
    }
    if (name === "fail_hevy_oauth_refresh") {
      if (connection) connection = {
        ...connection, oauth_status: args.p_retryable ? "active" : "reconnect_required",
        refresh_attempt_id: null, refresh_started_at: null,
      };
      return { data: true, error: null };
    }
    throw new Error(`Unexpected RPC: ${name}`);
  });
  mocks.fetch.mockImplementation(async (url: string) => new Response(JSON.stringify(
    url.includes("/api/token") ? { ...pair, user_id: provider, username: "lifter" } : { workouts: [] },
  )));
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("OAuth authorization", () => {
  it("uses fixed provider/callback URLs and stores only hashes of fresh browser-bound state", async () => {
    const first = await beginHevyOAuth(owner, "https://nakama.test");
    const second = await beginHevyOAuth(owner, "https://nakama.test");
    const url = new URL(first.authorizationUrl);
    expect(url.origin + url.pathname).toBe("https://hevy.com/oauth/authorize");
    expect(url.searchParams.get("redirect_uri")).toBe("https://nakama.test/api/hevy/oauth/callback");
    expect(url.searchParams.get("client_id")).toBe("test-client");
    expect(first.authorizationUrl).not.toContain("test-secret");
    expect(first.browser).not.toBe(second.browser);
    expect(url.searchParams.get("state")).not.toBe(new URL(second.authorizationUrl).searchParams.get("state"));
    expect(mocks.rpc.mock.calls[0]).toEqual(["begin_hevy_oauth", {
      p_user_id: owner,
      p_state_hash: createHash("sha256").update(url.searchParams.get("state")!).digest("hex"),
      p_browser_hash: createHash("sha256").update(first.browser).digest("hex"),
    }]);
  });

  it("fails explicitly if configuration or trusted callback origin is invalid", async () => {
    expect(() => hevyOAuthCallback("http://public.example")).toThrow("HTTPS");
    expect(hevyOAuthCallback("http://localhost:3002")).toBe("http://localhost:3002/api/hevy/oauth/callback");
    vi.stubEnv("HEVY_OAUTH_CLIENT_SECRET", "");
    await expect(beginHevyOAuth(owner, "https://nakama.test")).rejects.toMatchObject({ code: "configuration_unavailable" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("keeps an API-key user's working connection until the separate migration feature exists", async () => {
    mocks.rpc.mockResolvedValue({ data: "migration_required", error: null });
    await expect(beginHevyOAuth(owner, "https://nakama.test")).rejects.toMatchObject({ code: "migration_required", status: 409 });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    { ...callback, state: null }, { ...callback, browser: undefined }, { ...callback, state: "wrong-shape" },
  ])("rejects malformed or absent browser state before contacting Hevy", async input => {
    await expect(completeHevyOAuth(owner, input)).rejects.toMatchObject({ code: "invalid_state" });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects consumed, wrong-user, wrong-browser or expired state before exchanging a code", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    await expect(completeHevyOAuth(owner, callback)).rejects.toMatchObject({ code: "invalid_state" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("consumes cancellation without overwriting a connection or exchanging a code", async () => {
    await expect(completeHevyOAuth(owner, { ...callback, code: null, error: "access_denied" }))
      .rejects.toMatchObject({ code: "access_denied" });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("checks workout access and saves only encrypted validated tokens for the authenticated user", async () => {
    await completeHevyOAuth(owner, callback);
    const [url, options] = mocks.fetch.mock.calls[0];
    expect(url).toBe("https://hevy.com/api/token");
    expect(options.body.get("grant_type")).toBe("authorization_code");
    expect(options.body.get("client_secret")).toBe("test-secret");
    expect(options.redirect).toBe("error");
    expect(mocks.fetch.mock.calls[1][1].headers.Authorization).toBe("Bearer new-access");
    const saved = mocks.rpc.mock.calls.find(([name]) => name === "complete_hevy_oauth")![1];
    expect(saved).toMatchObject({ p_user_id: owner, p_hevy_user_id: provider, p_username: "lifter" });
    expect(saved.p_encrypted_oauth).not.toContain("new-access");
    expect(JSON.parse(decryptHevyKey(owner, saved.p_encrypted_oauth))).toEqual({
      access_token: pair.access_token, refresh_token: pair.refresh_token,
    });
  });

  it.each(["user_id", "refresh_token", "access_token"])("never stores an incomplete provider response (missing %s)", async missing => {
    const response: Record<string, unknown> = { ...pair, user_id: provider, username: "lifter" };
    delete response[missing];
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify(response)));
    await expect(completeHevyOAuth(owner, callback)).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("does not save a grant without workout access", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ...pair, user_id: provider, username: "lifter" })))
      .mockResolvedValueOnce(new Response("", { status: 403 }));
    await expect(completeHevyOAuth(owner, callback)).rejects.toMatchObject({ code: "missing_scope" });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("does not leak provider response bodies, codes or secrets on exchange failure", async () => {
    mocks.fetch.mockResolvedValue(new Response("authorization-code test-secret", { status: 400 }));
    await expect(completeHevyOAuth(owner, callback)).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/authorization-code|test-secret/);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});

describe("server-side credentials and rotating refresh", () => {
  it("delivers a report without a browser session, refreshing expired tokens before the workout and history reads", async () => {
    connection = row({ access_expires_at: new Date(Date.now() - 1000).toISOString() });
    const workoutId = "00000000-0000-4000-8000-000000000004";
    const saved: unknown[] = [];
    let claimed = false;
    let rotations = 0;
    const hevyHeaders: string[] = [];
    mocks.fetch.mockImplementation(async (input: URL | string, options?: RequestInit) => {
      const url = new URL(input);
      if (url.href === "https://hevy.com/api/token") {
        rotations++;
        return Response.json({
          ...pair, access_token: `access-${rotations}`, refresh_token: `refresh-${rotations}`,
        });
      }
      if (url.host === "api.hevyapp.com") {
        hevyHeaders.push(new Headers(options?.headers).get("Authorization") ?? "");
        if (url.pathname === `/v1/workouts/${workoutId}`) {
          connection = row({
            ...connection, access_expires_at: new Date(Date.now() - 1000).toISOString(),
          });
          return Response.json({
            id: workoutId, title: "Test session", start_time: "2026-11-18T10:00:00Z", end_time: "2026-11-18T11:00:00Z",
            exercises: [{ title: "Bench press", exercise_template_id: "BENCH", sets: [{ type: "normal", weight_kg: 50, reps: 8 }] }],
          });
        }
        if (url.pathname === "/v1/exercise_history/BENCH") return Response.json({ exercise_history: [] });
      }
      if (url.host === "reports.test") {
        if (url.pathname.endsWith("/rpc/claim_next_workout_report")) {
          const jobs = claimed ? [] : [{ user_id: owner, workout_id: workoutId, connection_revision: revision, conversation_id: workoutId, attempts: 1 }];
          claimed = true;
          return Response.json(jobs);
        }
        if (url.pathname.endsWith("/profiles")) return Response.json([{ units: "kg" }]);
        if (url.pathname.endsWith("/chat_conversations")) {
          saved.push(JSON.parse(String(options?.body)));
          return new Response(null, { status: 201 });
        }
        if (url.pathname.endsWith("/workout_reports")) return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected report integration request: ${url}`);
    });
    const reports = createClient<Database>("https://reports.test", "sb_secret_fixture", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const notify = vi.fn().mockResolvedValue(null);
    expect(await drainWorkoutReports(reports, () => new Date(), notify)).toMatchObject({ delivered: 1, failed: 0 });
    expect(saved).toHaveLength(1);
    expect(hevyHeaders).toEqual(["Bearer access-1", "Bearer access-2"]);
    expect(rotations).toBe(2);
    expect(connection).toMatchObject({ revision, token_version: 2 });
    const encrypted = connection?.encrypted_oauth;
    if (!encrypted) throw new Error("Missing stored refreshed token pair");
    expect(JSON.parse(decryptHevyKey(owner, encrypted)).refresh_token).toBe("refresh-2");
    expect(JSON.stringify(saved)).not.toMatch(/access-1|access-2|refresh-1|refresh-2/);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("keeps existing API-key credentials isolated and never refreshes them", async () => {
    connection = row({ credential_method: "api_key", encrypted_key: encryptHevyKey(owner, "personal-key") });
    expect(await loadHevyCredentials(owner)).toEqual({ method: "api_key", apiKey: "personal-key", revision });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("loads an unexpired OAuth access token without browser state", async () => {
    expect(await loadHevyCredentials(owner)).toEqual({
      method: "oauth", accessToken: "old-access", revision, hevyUserId: provider, tokenVersion: 0,
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("fails explicitly on damaged stored token JSON without exposing its contents", async () => {
    connection = row({ encrypted_oauth: encryptHevyKey(owner, "damaged-token-payload") });
    await expect(loadHevyCredentials(owner)).rejects.toMatchObject({ status: 503 });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("damaged-token-payload");
  });

  it("coordinates concurrent consumers and persists the new pair before returning it", async () => {
    connection = row({ access_expires_at: new Date(Date.now() - 1000).toISOString() });
    mocks.fetch.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return new Response(JSON.stringify(pair));
    });
    const [first, second] = await Promise.all([loadHevyCredentials(owner), loadHevyCredentials(owner)]);
    expect(first).toEqual({ method: "oauth", accessToken: "new-access", revision, hevyUserId: provider, tokenVersion: 1 });
    expect(second).toEqual(first);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const saved = mocks.rpc.mock.calls.find(([name]) => name === "finish_hevy_oauth_refresh")![1];
    expect(saved).toMatchObject({ p_revision: revision, p_token_version: 0 });
    expect(JSON.parse(decryptHevyKey(owner, saved.p_encrypted_oauth)).refresh_token).toBe("new-refresh");
  });

  it.each(["network", "invalid_grant", "unauthorized_grant", "malformed", "server_error"])("does not retry a possibly spent refresh token after %s", async failure => {
    connection = row({ access_expires_at: new Date(Date.now() - 1000).toISOString() });
    if (failure === "network") mocks.fetch.mockRejectedValue(new TypeError("fetch failed"));
    if (failure === "invalid_grant") mocks.fetch.mockResolvedValue(new Response("invalid grant", { status: 400 }));
    if (failure === "unauthorized_grant") mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 401 }));
    if (failure === "malformed") mocks.fetch.mockResolvedValue(new Response("{}"));
    if (failure === "server_error") mocks.fetch.mockResolvedValue(new Response("error", { status: 500 }));
    await expect(loadHevyCredentials(owner)).rejects.toMatchObject({ code: "reconnect_required" });
    await expect(loadHevyCredentials(owner)).rejects.toMatchObject({ code: "reconnect_required" });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("fail_hevy_oauth_refresh", expect.objectContaining({ p_retryable: false }));
  });

  it("allows later retry after an explicit rate-limit rejection", async () => {
    connection = row({ access_expires_at: new Date(Date.now() - 1000).toISOString() });
    mocks.fetch.mockResolvedValue(new Response("", { status: 429 }));
    await expect(loadHevyCredentials(owner)).rejects.toMatchObject({ status: 429, code: "provider_unavailable" });
    expect(connection.oauth_status).toBe("active");
    expect(mocks.rpc).toHaveBeenCalledWith("fail_hevy_oauth_refresh", expect.objectContaining({ p_retryable: true }));
  });

  it("keeps a user's grant intact when Hevy explicitly rejects the app's client authentication", async () => {
    connection = row({ access_expires_at: new Date(Date.now() - 1000).toISOString() });
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 }));
    await expect(loadHevyCredentials(owner)).rejects.toMatchObject({ status: 503, code: "provider_unavailable" });
    expect(connection.oauth_status).toBe("active");
  });

  it("does not expose refreshed credentials when storage fails or the refresh lease is lost", async () => {
    connection = row({ access_expires_at: new Date(Date.now() - 1000).toISOString() });
    mocks.rpc.mockResolvedValueOnce({ data: "claimed", error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    await expect(loadHevyCredentials(owner)).rejects.toMatchObject({ code: "connection_changed" });
  });

  it("leaves an ambiguous database save fenced instead of retrying the provider token", async () => {
    connection = row({ access_expires_at: new Date(Date.now() - 1000).toISOString() });
    mocks.rpc.mockResolvedValueOnce({ data: "claimed", error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "database_unavailable" } });
    await expect(loadHevyCredentials(owner)).rejects.toMatchObject({ status: 503 });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls.some(([name]) => name === "fail_hevy_oauth_refresh")).toBe(false);
  });
});
