import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHevyClient } from "./hevy-client";
import { waitForHevyRequest } from "./hevy-rate-limit";

const mocks = vi.hoisted(() => ({ load: vi.fn(), rpc: vi.fn(), fetch: vi.fn(), wait: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/hevy-oauth", () => ({ loadHevyCredentials: mocks.load }));
vi.mock("@/lib/hevy-connection", async original => ({
  ...await original<typeof import("@/lib/hevy-connection")>(), storage: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/hevy-rate-limit", () => ({ waitForHevyRequest: mocks.wait }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockImplementation(async () => Response.json({ workout_count: 7 }));
  mocks.wait.mockResolvedValue(undefined);
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.load.mockImplementation(async (userId: string) => ({
    method: "oauth", accessToken: `token-${userId}`, revision: `revision-${userId}`, tokenVersion: 3,
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("keeps concurrent user credentials isolated and never sends an access token as an API key", async () => {
  const [one, two] = await Promise.all([createHevyClient("one"), createHevyClient("two")]);
  await Promise.all([one.request("/workouts/count"), two.request("/workouts/count")]);
  expect(mocks.fetch.mock.calls.map(([, options]) => options.headers)).toEqual([
    { accept: "application/json", Authorization: "Bearer token-one" },
    { accept: "application/json", Authorization: "Bearer token-two" },
  ]);
  expect(JSON.stringify([one, two])).not.toContain("token-");
  mocks.load.mockResolvedValue({ method: "api_key", apiKey: "personal-key", revision: "key-revision" });
  await (await createHevyClient("legacy")).request("/workouts/count");
  expect(mocks.fetch.mock.calls[2][1].headers).toEqual({ accept: "application/json", "api-key": "personal-key" });
});

it("reloads credentials after pacing, uses rotated tokens and stops on a logical replacement", async () => {
  const client = await createHevyClient("one");
  mocks.wait.mockImplementationOnce(async () => {
    mocks.load.mockResolvedValue({ method: "oauth", accessToken: "rotated-token", revision: "revision-one", tokenVersion: 4 });
  });
  await client.request("/workouts/count");
  expect(mocks.fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer rotated-token");
  mocks.load.mockResolvedValue({ method: "oauth", accessToken: "wrong-account", revision: "replaced", tokenVersion: 0 });
  await expect(client.request("/workouts/count")).rejects.toMatchObject({ status: 409 });
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});

it("paces every retry and bounds read-only 429 backoff without relying on Retry-After", async () => {
  vi.useFakeTimers();
  const client = await createHevyClient("one");
  mocks.fetch.mockImplementation(async () => new Response(null, { status: 429 }));
  const failed = expect(client.request("/workouts/count")).rejects.toMatchObject({ status: 429, providerStatus: 429 });
  await vi.runAllTimersAsync();
  await failed;
  expect(mocks.fetch).toHaveBeenCalledTimes(3);
  expect(waitForHevyRequest).toHaveBeenCalledTimes(3);
});

it.each(["POST", "PUT"] as const)("never automatically repeats a %s, including explicit rate-limit failures", async method => {
  const client = await createHevyClient("one");
  mocks.fetch.mockResolvedValue(new Response(null, { status: 429 }));
  await expect(client.request("/routines", { method, body: { routine: {} } })).rejects.toThrow(/Check Hevy before approving/);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});

it.each(["network", "malformed", "server"] as const)("does not replay uncertain writes after %s errors or expose provider details", async failure => {
  const client = await createHevyClient("one");
  if (failure === "network") mocks.fetch.mockRejectedValue(new TypeError("secret-token-in-provider-diagnostic"));
  if (failure === "malformed") mocks.fetch.mockResolvedValue(new Response("secret-token-invalid-json"));
  if (failure === "server") mocks.fetch.mockResolvedValue(new Response("secret-token-in-response", { status: 500 }));
  const error = await client.request("/routines", { method: "POST", body: { routine: {} } }).catch((error: unknown) => error);
  expect(error).toMatchObject({ status: 502, message: expect.stringContaining("outcome may be uncertain") });
  expect(String(error)).not.toContain("secret-token");
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});

it("persists OAuth rejection against the exact token version without refreshing/retrying a 401", async () => {
  const client = await createHevyClient("one");
  mocks.fetch.mockResolvedValue(new Response(null, { status: 401 }));
  await expect(client.request("/workouts/count")).rejects.toMatchObject({ status: 409, providerStatus: 401 });
  expect(mocks.rpc).toHaveBeenCalledWith("reject_hevy_oauth_token", {
    p_user_id: "one", p_revision: "revision-one", p_token_version: 3,
  });
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});

it("does not silently ignore failure to persist rejected-token state", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const client = await createHevyClient("one");
  mocks.fetch.mockResolvedValue(new Response(null, { status: 401 }));
  mocks.rpc.mockResolvedValue({ error: { code: "XX001" } });
  await expect(client.request("/workouts/count")).rejects.toMatchObject({ status: 503 });
  expect(log).toHaveBeenCalledWith("Hevy rejected-token state could not be saved", { code: "XX001" });
  log.mockRestore();
});

it("reports scope/account-limit denials without revoking a working token or exposing the body", async () => {
  const client = await createHevyClient("one");
  mocks.fetch.mockResolvedValue(new Response("secret diagnostic", { status: 403 }));
  await expect(client.request("/routines")).rejects.toMatchObject({
    status: 403, message: expect.stringContaining("permissions"),
  });
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("cancels rate-limit backoff without another provider request", async () => {
  const abort = new AbortController();
  const client = await createHevyClient("one", abort.signal);
  mocks.fetch.mockImplementation(async () => { abort.abort(); return new Response(null, { status: 429 }); });
  await expect(client.request("/workouts/count")).rejects.toMatchObject({ name: "AbortError" });
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});

it.each(["https://other.invalid", "//other.invalid", "/workouts/../routines", "/workouts/%2e%2e", "/workouts/id?secret=x"])(
  "never sends credentials to an uncontrolled resource: %s", async path => {
    const client = await createHevyClient("one");
    await expect(client.request(path)).rejects.toMatchObject({ status: 400 });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
