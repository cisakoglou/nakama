import { afterEach, describe, expect, it, vi } from "vitest";
import { releasePushSubscription } from "@/lib/push-client";

function device(unsubscribe = vi.fn(async () => true)) {
  return { endpoint: "https://push.example.com/abc", unsubscribe };
}

afterEach(() => { vi.useRealTimers(); });

describe("releasePushSubscription", () => {
  it("deletes this device's endpoint on the server, then unsubscribes locally", async () => {
    const order: string[] = [];
    const sub = device(vi.fn(async () => { order.push("unsubscribe"); return true; }));
    const fetch = vi.fn(async () => { order.push("delete"); return new Response("{}"); });
    await releasePushSubscription({ subscription: async () => sub, fetch: fetch as unknown as typeof globalThis.fetch });
    expect(fetch).toHaveBeenCalledWith("/api/push", expect.objectContaining({
      method: "DELETE", body: JSON.stringify({ endpoint: sub.endpoint }),
    }));
    expect(order).toEqual(["delete", "unsubscribe"]);
  });

  it("does nothing without a subscription", async () => {
    const fetch = vi.fn();
    await releasePushSubscription({ subscription: async () => null, fetch: fetch as unknown as typeof globalThis.fetch });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never throws and still unsubscribes when the server call or lookup fails", async () => {
    const sub = device();
    await expect(releasePushSubscription({
      subscription: async () => sub, fetch: (async () => { throw new TypeError("offline"); }) as unknown as typeof globalThis.fetch,
    })).resolves.toBeUndefined();
    expect(sub.unsubscribe).toHaveBeenCalled();
    await expect(releasePushSubscription({
      subscription: async () => { throw new Error("no sw"); }, fetch: vi.fn() as unknown as typeof globalThis.fetch,
    })).resolves.toBeUndefined();
  });

  it("gives up after the timeout so sign-out is never blocked", async () => {
    vi.useFakeTimers();
    const hang = new Promise<Response>(() => {});
    const done = vi.fn();
    void releasePushSubscription({
      subscription: async () => device(), fetch: (() => hang) as unknown as typeof globalThis.fetch, timeoutMs: 50,
    }).then(done);
    await vi.advanceTimersByTimeAsync(49);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalled();
  });
});
