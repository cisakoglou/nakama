import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { waitForHevyRequest } from "./hevy-rate-limit";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/hevy-connection", async original => ({
  ...await original<typeof import("@/lib/hevy-connection")>(), storage: () => ({ rpc }),
}));
beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

it("does not issue a request when the shared budget is full", async () => {
  rpc.mockResolvedValue({ data: -1, error: null });
  await expect(waitForHevyRequest(new AbortController().signal)).rejects.toMatchObject({ status: 429 });
});

it.each([null, 5_001, -2, "0"])("fails closed with an invalid reservation (%s)", async data => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  rpc.mockResolvedValue({ data, error: null });
  await expect(waitForHevyRequest(new AbortController().signal)).rejects.toMatchObject({ status: 503 });
  expect(log).toHaveBeenCalled();
});

it("makes a reserved wait cancellable", async () => {
  rpc.mockResolvedValue({ data: 5_000, error: null });
  const abort = new AbortController();
  const waiting = waitForHevyRequest(abort.signal);
  abort.abort();
  await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
});
