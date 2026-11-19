import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WebhookStorageError } from "@/lib/hevy-webhook";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ accept: vi.fn(), wake: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/hevy-app-webhook", async (original) => ({
  ...await original<typeof import("@/lib/hevy-app-webhook")>(), acceptAppWebhook: mocks.accept,
}));
vi.mock("@/lib/workout-report-worker", () => ({ wakeWorkoutReportWorker: mocks.wake }));

const SECRET = "test-client-secret";
const owner = "00000000-0000-4000-8000-000000000001";
const hevyUser = "5c3a9b8e-1f2d-4e6a-9b7c-0d1e2f3a4b5c";
const workoutId = "f1085cdb-32b2-4003-967d-53a3af8eaecb";
const event = (overrides: Record<string, unknown> = {}) => JSON.stringify({ type: "workout.created", workoutId, userId: hevyUser, ...overrides });
const sign = (body: string | Uint8Array, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
function request(body: string | Uint8Array, signature: string | null = sign(body)) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== null) headers["hevy-signature"] = signature;
  return new NextRequest("https://nakama.test/api/hevy/app-webhook", { method: "POST", headers, body: body as BodyInit });
}
let logs: unknown[][];

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("HEVY_OAUTH_CLIENT_SECRET", SECRET);
  mocks.accept.mockResolvedValue({ result: "queued", userId: owner });
  logs = [];
  for (const level of ["warn", "info", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logs.push(args); });
  }
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const loggedText = () => JSON.stringify(logs);

it("queues a validly signed workout.created event for the verified Hevy user and wakes the worker", async () => {
  const response = await POST(request(event()));
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(mocks.accept).toHaveBeenCalledWith(hevyUser, workoutId, expect.any(AbortSignal));
  expect(mocks.wake).toHaveBeenCalledTimes(1);
  expect(logs).toContainEqual(["Hevy app webhook accepted", { userId: owner, queued: true }]);
});

it("verifies the exact raw bytes (whitespace and key order included) and accepts uppercase hex", async () => {
  const body = `{ "userId": "${hevyUser}",\n  "workoutId": "${workoutId}", "type": "workout.created", "extra": 1 }`;
  expect((await POST(request(body, sign(body).toUpperCase().replace("SHA256=", "sha256="))))).toHaveProperty("status", 200);
  expect(mocks.accept).toHaveBeenCalledTimes(1);
});

it.each([
  ["missing", () => null, "missing_signature"],
  ["malformed", () => "sha256=not-hex", "malformed_signature"],
  ["unprefixed", (body: string) => sign(body).slice(7), "malformed_signature"],
  ["signed with another secret", (body: string) => sign(body, "old-secret"), "mismatch_signature"],
  ["for a different body", () => sign(event({ workoutId: "11111111-1111-4111-8111-111111111111" })), "mismatch_signature"],
])("rejects a %s signature without enqueuing", async (_, signature, reason) => {
  const body = event();
  const header = signature(body);
  const response = await POST(request(body, header));
  expect(response.status).toBe(401);
  expect(mocks.accept).not.toHaveBeenCalled();
  expect(logs[0]?.[0]).toBe("Hevy app webhook rejected");
  expect((logs[0]?.[1] as { reason: string }).reason).toBe(reason);
  expect(loggedText()).not.toContain(SECRET);
  if (header) expect(loggedText()).not.toContain(header.slice(7, 30));
});

it("rejects a tampered body even with a previously valid signature", async () => {
  const original = event();
  const tampered = original.replace(hevyUser, "00000000-0000-4000-8000-0000000000ff");
  expect((await POST(request(tampered, sign(original)))).status).toBe(401);
  expect(mocks.accept).not.toHaveBeenCalled();
});

it("rejects oversized bodies before verifying or storing", async () => {
  const body = event({ padding: "x".repeat(5000) });
  const response = await POST(request(body));
  expect(response.status).toBe(413);
  expect(mocks.accept).not.toHaveBeenCalled();
});

it.each([
  ["invalid JSON", "{not json", 400],
  ["invalid UTF-8", new Uint8Array([0x7b, 0xff, 0x7d]), 400],
  ["a non-object", "[]", 400],
  ["a missing userId", JSON.stringify({ type: "workout.created", workoutId }), 400],
  ["a non-uuid workoutId", event({ workoutId: "../../x" }), 400],
  ["a non-uuid userId", event({ userId: "someone@example.test" }), 400],
])("rejects signed %s", async (_, body, status) => {
  const response = await POST(request(body));
  expect(response.status).toBe(status);
  expect(mocks.accept).not.toHaveBeenCalled();
});

it("acknowledges but ignores unknown signed event types", async () => {
  const response = await POST(request(event({ type: "workout.deleted" })));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ received: true, ignored: true });
  expect(mocks.accept).not.toHaveBeenCalled();
  expect(logs[0]?.[1]).toEqual({ reason: "unsupported_event", type: "workout.deleted" });
});

it.each(["unknown_user", "not_eligible", "reconnect_required", "reports_off"] as const)(
  "acknowledges %s without queuing or waking the worker", async (result) => {
    mocks.accept.mockResolvedValue({ result, userId: result === "unknown_user" ? null : owner });
    const response = await POST(request(event()));
    expect(response.status).toBe(200);
    expect(mocks.wake).not.toHaveBeenCalled();
    expect(logs[0]?.[1]).toMatchObject({ reason: result, hevyUser: hevyUser.slice(0, 8) });
    expect(loggedText()).not.toContain(hevyUser);
  },
);

it("acknowledges duplicates (redelivery, or the same workout via the personal webhook) without waking", async () => {
  mocks.accept.mockResolvedValue({ result: "duplicate", userId: owner });
  expect((await POST(request(event()))).status).toBe(200);
  expect(mocks.wake).not.toHaveBeenCalled();
});

it("returns a retryable 503 when the event cannot be stored", async () => {
  mocks.accept.mockRejectedValue(new WebhookStorageError("down"));
  const response = await POST(request(event()));
  expect(response.status).toBe(503);
  expect(mocks.wake).not.toHaveBeenCalled();
});

it("returns 503 when the client secret is not configured", async () => {
  vi.stubEnv("HEVY_OAUTH_CLIENT_SECRET", "");
  expect((await POST(request(event()))).status).toBe(503);
  expect(mocks.accept).not.toHaveBeenCalled();
});
