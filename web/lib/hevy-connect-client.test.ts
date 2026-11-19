import { describe, expect, it, vi } from "vitest";
import {
  canRetryOAuth, fetchReports, OAuthStartError, oauthErrorCode, oauthErrorMessage, readOAuthReturn, relativeTime,
  saveReportsEnabled, startHevyOAuth, withoutOAuthParams,
} from "./hevy-connect-client";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("startHevyOAuth", () => {
  it("POSTs only to /api/hevy/oauth/start and returns the authorization URL", async () => {
    const fetchFn = vi.fn(async () => json({ authorization_url: "https://hevy.com/oauth/authorize?x=1" }));
    expect(await startHevyOAuth(fetchFn as never)).toBe("https://hevy.com/oauth/authorize?x=1");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith("/api/hevy/oauth/start", { method: "POST" });
  });

  it("never calls DELETE, so reconnecting keeps the existing connection", async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => json({ authorization_url: "https://hevy.com/a" }));
    await startHevyOAuth(fetchFn as never);
    expect(fetchFn.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "DELETE")).toBe(false);
  });

  it("maps migration_required and other codes to friendly errors", async () => {
    const error = await startHevyOAuth((async () => json({ error: "raw", code: "migration_required" }, 409)) as never).catch((e) => e);
    expect(error).toBeInstanceOf(OAuthStartError);
    expect(error.code).toBe("migration_required");
    expect(error.message).toBe(oauthErrorMessage("migration_required"));
    expect(error.message).not.toContain("raw");
  });

  it("falls back to a generic message for malformed, non-https or failed responses", async () => {
    for (const make of [
      async () => json({ authorization_url: "http://insecure.example" }),
      async () => json({ nope: true }),
      async () => new Response("<html>", { status: 500 }),
      async () => { throw new TypeError("network"); },
    ]) {
      await expect(startHevyOAuth(make as never)).rejects.toBeInstanceOf(OAuthStartError);
    }
  });
});

describe("OAuth return parameters", () => {
  it("reads connected and error returns; query is only a hint", () => {
    expect(readOAuthReturn("?hevy_oauth=connected")).toEqual({ kind: "connected" });
    expect(readOAuthReturn("?hevy_oauth=error&code=access_denied")).toEqual({ kind: "error", code: "access_denied" });
    expect(readOAuthReturn("?hevy_oauth=error&code=signed_out")).toEqual({ kind: "error", code: "signed_out" });
    expect(readOAuthReturn("?hevy_oauth=error&code=whatever")).toEqual({ kind: "error", code: "unknown" });
    expect(readOAuthReturn("?hevy_oauth=error")).toEqual({ kind: "error", code: "unknown" });
    expect(readOAuthReturn("?hevy_oauth=other")).toBeNull();
    expect(readOAuthReturn("")).toBeNull();
  });

  it("has a message for every code and offers retry except where it cannot help", () => {
    for (const code of ["access_denied", "invalid_state", "account_in_use", "account_mismatch", "connection_changed",
      "migration_required", "missing_scope", "not_eligible", "provider_unavailable", "configuration_unavailable",
      "reconnect_required", "refresh_busy", "signed_out", "unknown"] as const) {
      expect(oauthErrorMessage(oauthErrorCode(code)).length).toBeGreaterThan(10);
    }
    expect(oauthErrorMessage("access_denied")).toContain("nothing changed");
    expect(canRetryOAuth("access_denied")).toBe(true);
    expect(canRetryOAuth("migration_required")).toBe(false);
  });

  it("removes only the OAuth parameters from the URL", () => {
    expect(withoutOAuthParams("https://nakama.test/?hevy_oauth=error&code=access_denied&chat=abc#x")).toBe("/?chat=abc#x");
    expect(withoutOAuthParams("https://nakama.test/?hevy_oauth=connected")).toBe("/");
  });
});

describe("reports client", () => {
  const state = { enabled: true, status: "waiting", last_received_at: null, last_report: null };

  it("reads and updates the report preference", async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => json({ ...state, enabled: init?.method === "PUT" ? false : true }));
    expect((await fetchReports(fetchFn as never)).enabled).toBe(true);
    expect((await saveReportsEnabled(false, fetchFn as never)).enabled).toBe(false);
    expect(fetchFn).toHaveBeenLastCalledWith("/api/hevy/reports", expect.objectContaining({ method: "PUT", body: '{"enabled":false}' }));
  });

  it("rejects failed or malformed responses", async () => {
    await expect(fetchReports((async () => json({ error: "x", code: "not_oauth" }, 404)) as never)).rejects.toThrow();
    await expect(fetchReports((async () => json({ enabled: "yes" })) as never)).rejects.toThrow();
    await expect(saveReportsEnabled(true, (async () => json({ error: "bad" }, 400)) as never)).rejects.toThrow();
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-11-19T12:00:00Z");
  it("is relative for recent times", () => {
    expect(relativeTime("2026-11-19T11:59:40Z", now)).toBe("just now");
    expect(relativeTime("2026-11-19T11:55:00Z", now)).toBe("5 minutes ago");
    expect(relativeTime("2026-11-19T11:00:00Z", now)).toBe("1 hour ago");
    expect(relativeTime("2026-11-17T12:00:00Z", now)).toBe("2 days ago");
    expect(relativeTime("garbage", now)).toBe("garbage");
  });
});
