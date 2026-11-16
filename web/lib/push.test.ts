import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  rows: [] as Row[], selectError: null as null | { code: string }, ops: [] as { kind: string; values?: Row; id: unknown }[],
  send: vi.fn(), storage: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("web-push", () => {
  class WebPushError extends Error {
    constructor(message: string, public statusCode: number) { super(message); }
  }
  return { default: { sendNotification: state.send }, WebPushError };
});
vi.mock("@/lib/hevy-connection", async (original) => ({
  ...await original<typeof import("@/lib/hevy-connection")>(), storage: state.storage,
}));

import { WebPushError } from "web-push";
import { MAX_PUSH_FAILURES, notifyReportReady, pushConfig } from "./push";

const userId = "00000000-0000-4000-8000-000000000001";
const conversationId = "00000000-0000-4000-8000-0000000000c1";
const vapid = { VAPID_PUBLIC_KEY: `B${"A".repeat(86)}`, VAPID_PRIVATE_KEY: "p".repeat(43), VAPID_SUBJECT: "mailto:ops@example.test" };

function fakeDb() {
  return {
    from: () => ({
      select: () => ({ eq: async (_column: string, value: unknown) => state.selectError
        ? { data: null, error: state.selectError }
        : { data: state.rows.filter((row) => row.user_id === value), error: null } }),
      update: (values: Row) => ({ eq: async (_column: string, id: unknown) => { state.ops.push({ kind: "update", values, id }); return { error: null }; } }),
      delete: () => ({ eq: async (_column: string, id: unknown) => { state.ops.push({ kind: "delete", id }); return { error: null }; } }),
    }),
  };
}

const pushError = (status: number) => new WebPushError("push failed", status, {}, "", "https://push.example.test");
const subscription = (id: string, failureCount = 0) => ({
  id, user_id: userId, endpoint: `https://push.example.test/${id}`, p256dh: `key-${id}`, auth: `auth-${id}`, failure_count: failureCount,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  for (const [name, value] of Object.entries(vapid)) vi.stubEnv(name, value);
  vi.spyOn(console, "error").mockImplementation(() => {});
  state.rows = [subscription("a")];
  state.selectError = null;
  state.ops = [];
  state.storage.mockReturnValue(fakeDb());
  state.send.mockResolvedValue({ statusCode: 201 });
});

describe("push configuration", () => {
  it.each(["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"])("is disabled when %s is missing", async (name) => {
    vi.stubEnv(name, "");
    expect(pushConfig()).toBeNull();
    expect(await notifyReportReady(userId, { conversationId, title: "Legs" })).toBeNull();
    expect(state.storage).not.toHaveBeenCalled();
    expect(state.send).not.toHaveBeenCalled();
  });

  it("rejects a malformed subject", () => {
    vi.stubEnv("VAPID_SUBJECT", "ops@example.test");
    expect(pushConfig()).toBeNull();
  });
});

describe("report notifications", () => {
  it("sends only the conversation id and title, signed with the VAPID key and collapsed per report", async () => {
    expect(await notifyReportReady(userId, { conversationId, title: "Legs" })).toEqual({ sent: 1, removed: 0, failed: 0 });
    const [target, body, options] = state.send.mock.calls[0];
    expect(target).toEqual({ endpoint: "https://push.example.test/a", keys: { p256dh: "key-a", auth: "auth-a" } });
    expect(JSON.parse(body)).toEqual({ conversationId, title: "Legs" });
    expect(options).toMatchObject({
      vapidDetails: { subject: vapid.VAPID_SUBJECT, publicKey: vapid.VAPID_PUBLIC_KEY, privateKey: vapid.VAPID_PRIVATE_KEY },
      topic: conversationId.replace(/-/g, ""), timeout: 5_000,
    });
    expect(state.ops).toEqual([{ kind: "update", id: "a", values: { last_success_at: expect.any(String), failure_count: 0 } }]);
  });

  it("deletes subscriptions the push service reports as gone", async () => {
    state.rows = [subscription("gone"), subscription("missing"), subscription("ok")];
    state.send.mockImplementation(async ({ endpoint }: { endpoint: string }) => {
      if (endpoint.endsWith("gone")) throw pushError(410);
      if (endpoint.endsWith("missing")) throw pushError(404);
      return { statusCode: 201 };
    });
    expect(await notifyReportReady(userId, { conversationId, title: "Legs" })).toEqual({ sent: 1, removed: 2, failed: 0 });
    expect(state.ops.filter((op) => op.kind === "delete").map((op) => op.id).sort()).toEqual(["gone", "missing"]);
  });

  it("counts other failures and drops a subscription after repeated failures", async () => {
    state.rows = [subscription("flaky", 1), subscription("dying", MAX_PUSH_FAILURES - 1)];
    state.send.mockRejectedValue(pushError(500));
    expect(await notifyReportReady(userId, { conversationId, title: "Legs" })).toEqual({ sent: 0, removed: 1, failed: 1 });
    expect(state.ops).toContainEqual({ kind: "update", id: "flaky", values: { failure_count: 2 } });
    expect(state.ops).toContainEqual({ kind: "delete", id: "dying" });
  });

  it("treats network errors as failures and never throws", async () => {
    state.send.mockRejectedValue(new TypeError("fetch failed"));
    expect(await notifyReportReady(userId, { conversationId, title: "Legs" })).toEqual({ sent: 0, removed: 0, failed: 1 });
    state.selectError = { code: "57014" };
    await expect(notifyReportReady(userId, { conversationId, title: "Legs" })).resolves.toEqual({ sent: 0, removed: 0, failed: 0 });
    state.storage.mockImplementation(() => { throw new Error("storage down"); });
    await expect(notifyReportReady(userId, { conversationId, title: "Legs" })).resolves.toBeDefined();
  });
});
