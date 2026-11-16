import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: { code: string } | null };
const state = vi.hoisted(() => ({
  results: {} as Record<string, Result>, calls: [] as { table: string; method: string; args: unknown[] }[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/hevy-connection", () => {
  class HevyConnectionError extends Error {}
  const from = (table: string) => {
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "gte", "order", "limit", "upsert"]) {
      query[method] = (...args: unknown[]) => { state.calls.push({ table, method, args }); return query; };
    }
    query.maybeSingle = async () => state.results[table];
    query.abortSignal = async () => state.results[table];
    return query;
  };
  return { HevyConnectionError, storage: () => ({ from }) };
});

import {
  enqueueWorkoutReport, hashWebhookToken, WORKOUT_REPORT_FIRST_ATTEMPT_DELAY_MS, webhookFingerprint, webhookTokenStatus,
  WebhookStorageError,
} from "./hevy-webhook";

const userId = "00000000-0000-4000-8000-000000000001";
const ok = (data: unknown): Result => ({ data, error: null });

beforeEach(() => {
  state.calls = [];
  state.results = {
    hevy_webhook_tokens: ok({ connection_revision: "rev-2", created_at: "2026-11-13T00:00:00Z", token_hash: `0a1b2c3d${"e".repeat(56)}` }),
    hevy_connections: ok({ revision: "rev-2" }),
    workout_reports: ok({ created_at: "2026-11-14T08:30:00Z" }),
  };
});

describe("webhookTokenStatus", () => {
  it("reports the latest delivery received through the current header", async () => {
    expect(await webhookTokenStatus(userId)).toEqual({
      configured: true, created_at: "2026-11-13T00:00:00Z", fingerprint: "0a1b2c3d", last_received_at: "2026-11-14T08:30:00Z",
    });
    const reports = state.calls.filter((c) => c.table === "workout_reports").map(({ method, args }) => [method, ...args]);
    expect(reports).toEqual([
      ["select", "created_at"], ["eq", "user_id", userId], ["eq", "connection_revision", "rev-2"],
      ["gte", "created_at", "2026-11-13T00:00:00Z"], ["order", "created_at", { ascending: false }], ["limit", 1],
    ]);
  });

  it("is waiting when nothing has arrived since the header was created", async () => {
    state.results.workout_reports = ok(null);
    expect(await webhookTokenStatus(userId)).toMatchObject({ configured: true, last_received_at: null });
  });

  it.each([
    ["no token", { hevy_webhook_tokens: ok(null) }],
    ["no connection", { hevy_connections: ok(null) }],
    ["a replaced Hevy key", { hevy_connections: ok({ revision: "rev-3" }) }],
  ])("skips the delivery lookup with %s", async (_, results) => {
    Object.assign(state.results, results);
    expect(await webhookTokenStatus(userId)).toMatchObject({ configured: false, last_received_at: null });
    expect(state.calls.some((c) => c.table === "workout_reports")).toBe(false);
  });

  it("raises a storage error when the delivery lookup fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.results.workout_reports = { data: null, error: { code: "57014" } };
    await expect(webhookTokenStatus(userId)).rejects.toBeInstanceOf(WebhookStorageError);
  });
});

describe("webhookFingerprint", () => {
  it("is the first 8 hex characters of the token hash, never the token", () => {
    const token = `nkwh_${"b".repeat(43)}`;
    const fingerprint = webhookFingerprint(hashWebhookToken(token));
    expect(fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(token).not.toContain(fingerprint);
  });
});

describe("enqueueWorkoutReport", () => {
  it("queues the job to become due only after the first-attempt delay, ignoring duplicates", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-16T10:00:00.000Z"), toFake: ["Date"] });
    state.results.workout_reports = ok([{ workout_id: "w1" }]);
    const result = await enqueueWorkoutReport({ userId, revision: "rev-2" }, "w1", new AbortController().signal);
    vi.useRealTimers();
    expect(result).toEqual({ queued: true });
    expect(WORKOUT_REPORT_FIRST_ATTEMPT_DELAY_MS).toBeGreaterThanOrEqual(20_000);
    expect(WORKOUT_REPORT_FIRST_ATTEMPT_DELAY_MS).toBeLessThanOrEqual(30_000);
    const upsert = state.calls.find((call) => call.method === "upsert")!;
    expect(upsert.args).toEqual([
      {
        user_id: userId, workout_id: "w1", connection_revision: "rev-2",
        available_at: new Date(Date.parse("2026-11-16T10:00:00.000Z") + WORKOUT_REPORT_FIRST_ATTEMPT_DELAY_MS).toISOString(),
      },
      { onConflict: "user_id,workout_id", ignoreDuplicates: true },
    ]);
  });

  it("reports a duplicate delivery as not queued", async () => {
    state.results.workout_reports = ok([]);
    expect(await enqueueWorkoutReport({ userId, revision: "rev-2" }, "w1", new AbortController().signal)).toEqual({ queued: false });
  });
});
