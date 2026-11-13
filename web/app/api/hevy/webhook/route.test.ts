import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEBHOOK_STORAGE_DEADLINE_MS } from "@/lib/hevy-webhook";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  enqueue: vi.fn(),
  wake: vi.fn(),
  fetch: vi.fn(),
  StorageError: class extends Error {},
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/hevy-webhook", async (original) => ({
  ...await original<typeof import("@/lib/hevy-webhook")>(),
  resolveWebhookOwner: mocks.resolve,
  enqueueWorkoutReport: mocks.enqueue,
  WebhookStorageError: mocks.StorageError,
}));
vi.mock("@/lib/workout-report-worker", () => ({
  wakeWorkoutReportWorker: mocks.wake,
}));

const token = `nkwh_${"a".repeat(43)}`;
const owner = {
  userId: "00000000-0000-4000-8000-000000000001",
  revision: "00000000-0000-4000-8000-000000000002",
};
const workoutId = "00000000-0000-4000-8000-000000000003";
const payload = JSON.stringify({ workoutId });

function request(
  body = payload,
  authorization: string | null = `Bearer ${token}`,
  headers: Record<string, string> = {},
) {
  return new NextRequest("https://nakama.test/api/hevy/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization === null ? {} : { authorization }),
      ...headers,
    },
    body,
  });
}

function expectPrivate(response: Response) {
  expect(response.headers.get("cache-control")).toMatch(/private/);
  expect(response.headers.get("cache-control")).toMatch(/no-store/);
}

function deadlineClock() {
  vi.useFakeTimers();
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
    setTimeout(() => controller.abort(new DOMException("Request deadline exceeded.", "TimeoutError")), milliseconds);
    return controller.signal;
  });
  return { signal: controller.signal, timeout };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.resolve.mockResolvedValue(owner);
  mocks.enqueue.mockResolvedValue({ queued: true });
  mocks.fetch.mockImplementation(() => { throw new Error("Webhook acknowledgement must not fetch upstream data."); });
  vi.stubGlobal("fetch", mocks.fetch);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Hevy webhook acknowledgement", () => {
  it.each([`Bearer ${token}`, token])("binds valid authorization to its connection owner (%#)", async (authorization) => {
    const response = await POST(request(payload, authorization));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expectPrivate(response);
    expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(token, expect.any(AbortSignal));
    const signal = mocks.resolve.mock.calls[0][1];
    expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith(owner, workoutId, signal);
    expect(mocks.wake).toHaveBeenCalledOnce();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([null, "Basic invalid", "Bearer invalid", "Bearer nkwh_short", `Bearer ${token} extra`])(
    "rejects missing or malformed authorization before owner lookup or reading the body (%j)",
    async (authorization) => {
      const req = request("invalid JSON", authorization);
      const readBody = vi.spyOn(req, "body", "get");
      const response = await POST(req);
      expect(response.status).toBe(401);
      expectPrivate(response);
      expect(mocks.resolve).not.toHaveBeenCalled();
      expect(readBody).not.toHaveBeenCalled();
      expect(mocks.enqueue).not.toHaveBeenCalled();
      expect(mocks.wake).not.toHaveBeenCalled();
    },
  );

  it("rejects unknown, revoked or replaced-connection tokens before reading the body", async () => {
    mocks.resolve.mockResolvedValue(null);
    const req = request("invalid JSON");
    const readBody = vi.spyOn(req, "body", "get");
    const response = await POST(req);
    expect(response.status).toBe(401);
    expectPrivate(response);
    expect(mocks.resolve).toHaveBeenCalledOnce();
    expect(readBody).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.wake).not.toHaveBeenCalled();
  });

  it.each([
    "invalid JSON", "null", "[]", "{}", JSON.stringify({ workoutId: "" }),
    JSON.stringify({ workoutId: "not-a-uuid" }), JSON.stringify({ workoutId: 123 }),
    JSON.stringify({ workoutId: [workoutId] }),
  ])("rejects malformed or invalid workout payloads (%s)", async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expectPrivate(response);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.wake).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("ignores payload-supplied user and revision fields instead of routing by them", async () => {
    const forged = {
      workoutId,
      userId: "00000000-0000-4000-8000-000000000099",
      user_id: "00000000-0000-4000-8000-000000000098",
      revision: "00000000-0000-4000-8000-000000000097",
    };
    const response = await POST(request(JSON.stringify(forged)));
    expect(response.status).toBe(200);
    expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith(owner, workoutId, expect.any(AbortSignal));
  });

  it("routes an identical workout ID independently for a second resolved connection owner", async () => {
    const second = {
      userId: "00000000-0000-4000-8000-000000000004",
      revision: "00000000-0000-4000-8000-000000000005",
    };
    await POST(request());
    mocks.resolve.mockResolvedValue(second);
    await POST(request(payload, `Bearer nkwh_${"b".repeat(43)}`));
    expect(mocks.enqueue.mock.calls.map(([connection]) => connection)).toEqual([owner, second]);
  });

  it.each<{ body: string; headers: Record<string, string> }>([
    { body: JSON.stringify({ workoutId, padding: "x".repeat(4096) }), headers: {} },
    { body: JSON.stringify({ workoutId, padding: "x".repeat(4096) }), headers: { "content-length": "1" } },
    { body: JSON.stringify({ workoutId, padding: "\u00e9".repeat(2100) }), headers: {} },
  ])("enforces the actual 4096-byte body limit, not just Content-Length (%#)", async ({ body, headers }) => {
    const response = await POST(request(body, `Bearer ${token}`, headers));
    expect(response.status).toBe(413);
    expectPrivate(response);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.wake).not.toHaveBeenCalled();
  });

  it("accepts a valid payload at the exact byte limit", async () => {
    const base = JSON.stringify({ workoutId, padding: "" });
    const body = JSON.stringify({ workoutId, padding: "x".repeat(4096 - Buffer.byteLength(base)) });
    expect(Buffer.byteLength(body)).toBe(4096);
    expect((await POST(request(body))).status).toBe(200);
    expect(mocks.enqueue).toHaveBeenCalledOnce();
  });

  it("acknowledges duplicates without scheduling a second worker wake", async () => {
    mocks.enqueue.mockResolvedValueOnce({ queued: true }).mockResolvedValueOnce({ queued: false });
    const first = await POST(request());
    const duplicate = await POST(request());
    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toEqual({ received: true });
    expectPrivate(duplicate);
    expect(mocks.enqueue).toHaveBeenCalledTimes(2);
    expect(mocks.wake).toHaveBeenCalledOnce();
  });

  it("does not acknowledge or wake the worker before durable enqueue resolves", async () => {
    let commit!: (value: { queued: boolean }) => void;
    mocks.enqueue.mockReturnValue(new Promise<{ queued: boolean }>((resolve) => { commit = resolve; }));
    let acknowledged = false;
    const response = POST(request()).then((result) => {
      acknowledged = true;
      return result;
    });
    await vi.waitFor(() => expect(mocks.enqueue).toHaveBeenCalledOnce());
    expect(acknowledged).toBe(false);
    expect(mocks.wake).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    commit({ queued: true });
    expect((await response).status).toBe(200);
    expect(mocks.wake).toHaveBeenCalledOnce();
  });

  it.each(["resolve", "enqueue"] as const)("returns a retryable failure when %s storage is unavailable", async (stage) => {
    mocks[stage].mockRejectedValue(new mocks.StorageError("private database failure details"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expectPrivate(response);
    expect(await response.text()).not.toContain("private database failure details");
    expect(mocks.wake).not.toHaveBeenCalled();
    if (stage === "resolve") expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("uses one shared deadline for owner lookup and enqueue, returning 503 before five seconds", async () => {
    const { signal, timeout } = deadlineClock();
    mocks.resolve.mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve(owner), 2500);
    }));
    mocks.enqueue.mockImplementation((_owner, _workoutId, enqueueSignal: AbortSignal) =>
      new Promise((_resolve, reject) => {
        enqueueSignal.addEventListener("abort", () => reject(enqueueSignal.reason), { once: true });
      }));
    let result: Response | undefined;
    const pending = POST(request()).then((response) => { result = response; });
    await vi.advanceTimersByTimeAsync(2500);
    expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith(owner, workoutId, signal);
    await vi.advanceTimersByTimeAsync(499);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(timeout).toHaveBeenCalledExactlyOnceWith(WEBHOOK_STORAGE_DEADLINE_MS);
    expect(result?.status).toBe(503);
    if (result) expectPrivate(result);
    expect(mocks.wake).not.toHaveBeenCalled();
  });

  it.each([
    { bytes: 4097, elapsed: 0, status: 413 },
    { bytes: 0, elapsed: 3000, status: 503 },
  ])("stops an unfinished body stream at its byte/deadline limit (%#)", async ({ bytes, elapsed, status }) => {
    deadlineClock();
    const cancel = vi.fn();
    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        bodyController = controller;
        if (bytes) controller.enqueue(new Uint8Array(bytes).fill(120));
      },
      cancel,
    });
    const req = new NextRequest("https://nakama.test/api/hevy/webhook", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body,
    });
    let result: Response | undefined;
    const pending = POST(req).then((response) => { result = response; });
    try {
      await vi.advanceTimersByTimeAsync(elapsed);
      expect(result?.status).toBe(status);
      if (result) expectPrivate(result);
      expect(cancel).toHaveBeenCalledOnce();
      expect(mocks.enqueue).not.toHaveBeenCalled();
      expect(mocks.wake).not.toHaveBeenCalled();
    } finally {
      if (!cancel.mock.calls.length) bodyController.close();
      await pending;
    }
  });
});
