import { beforeEach, expect, it, vi } from "vitest";
import { WebhookStorageError } from "./hevy-webhook";
import { acceptAppWebhook } from "./hevy-app-webhook";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/hevy-connection", async (original) => ({
  ...await original<typeof import("@/lib/hevy-connection")>(),
  storage: () => ({ rpc: (...args: unknown[]) => ({ abortSignal: () => mocks.rpc(...args) }) }),
}));

const owner = "00000000-0000-4000-8000-000000000001";
const hevyUser = "5c3a9b8e-1f2d-4e6a-9b7c-0d1e2f3a4b5c";
const workoutId = "f1085cdb-32b2-4003-967d-53a3af8eaecb";
beforeEach(() => { vi.resetAllMocks(); vi.spyOn(console, "error").mockImplementation(() => {}); });

it("stores the event in one call, due after the first-attempt delay", async () => {
  mocks.rpc.mockResolvedValue({ data: [{ result: "queued", user_id: owner }], error: null });
  const before = Date.now();
  expect(await acceptAppWebhook(hevyUser, workoutId, new AbortController().signal)).toEqual({ result: "queued", userId: owner });
  const [name, args] = mocks.rpc.mock.calls[0];
  expect(name).toBe("accept_hevy_app_webhook");
  expect(args).toMatchObject({ p_hevy_user_id: hevyUser, p_workout_id: workoutId });
  expect(Date.parse(args.p_available_at) - before).toBeGreaterThanOrEqual(19_000);
});

it.each([
  ["a database error", { data: null, error: { code: "57014" } }],
  ["an unknown result", { data: [{ result: "maybe", user_id: null }], error: null }],
  ["no row", { data: [], error: null }],
])("throws a retryable storage error on %s", async (_, reply) => {
  mocks.rpc.mockResolvedValue(reply);
  await expect(acceptAppWebhook(hevyUser, workoutId, new AbortController().signal)).rejects.toBeInstanceOf(WebhookStorageError);
});
