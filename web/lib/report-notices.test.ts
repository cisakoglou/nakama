import { describe, expect, it } from "vitest";
import type { ConversationSummary } from "@/lib/conversation-types";
import { base64UrlToBytes, pushSupport, sameServerKey, type PushEnvironment } from "./push-client";
import {
  chatDeepLink, latestCreatedAt, mergeLatest, newReportIds, reportsSeenStore, withoutChatParam,
} from "./report-notices";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const chat = (n: number, title: string, created: string, updated = created): ConversationSummary => ({
  id: id(n), title, status: "ready", created_at: created, updated_at: updated,
});

describe("chat deep links", () => {
  it("accepts only a conversation uuid", () => {
    expect(chatDeepLink(`?chat=${id(1).toUpperCase()}`)).toBe(id(1));
    expect(chatDeepLink("?chat=../settings")).toBeNull();
    expect(chatDeepLink("?other=1")).toBeNull();
  });

  it("removes only the chat parameter", () => {
    expect(withoutChatParam(`https://nakama.test/?chat=${id(1)}&x=1#top`)).toBe("/?x=1#top");
    expect(withoutChatParam(`https://nakama.test/?chat=${id(1)}`)).toBe("/");
  });
});

describe("new workout reports", () => {
  const chats = [
    chat(1, "Workout report: Legs", "2026-11-15T10:00:00Z"),
    chat(2, "Workout report: Push", "2026-11-14T10:00:00Z", "2026-11-15T11:00:00Z"),
    chat(3, "Plan my week", "2026-11-15T12:00:00Z"),
  ];

  it("marks report chats created after the seen mark, ignoring later activity in old reports", () => {
    expect([...newReportIds(chats, "2026-11-15T00:00:00Z")]).toEqual([id(1)]);
    expect([...newReportIds(chats, "2026-11-13T00:00:00Z")].sort()).toEqual([id(1), id(2)]);
  });

  it("does not mark the open chat, or anything without a seen mark", () => {
    expect(newReportIds(chats, "2026-11-15T00:00:00Z", id(1)).size).toBe(0);
    expect(newReportIds(chats, null).size).toBe(0);
    expect(newReportIds(chats, "garbage").size).toBe(0);
  });

  it("uses the newest server timestamp as the seen mark", () => {
    expect(latestCreatedAt(chats, null)).toBe("2026-11-15T12:00:00Z");
    expect(latestCreatedAt([], "2026-01-01T00:00:00Z")).toBe("2026-01-01T00:00:00Z");
  });

  it("merges a refreshed first page without dropping older loaded chats", () => {
    const older = chat(9, "Old chat", "2026-10-01T00:00:00Z");
    const fresh = [chat(4, "Workout report: Pull", "2026-11-15T13:00:00Z"), { ...chats[0], title: "Renamed" }];
    expect(mergeLatest(fresh, [...chats, older]).map((c) => c.title)).toEqual([
      "Workout report: Pull", "Plan my week", "Workout report: Push", "Renamed", "Old chat",
    ]);
  });

  it("stores the mark per account and survives broken storage", () => {
    const map = new Map<string, string>();
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } } as Storage;
    reportsSeenStore(storage, "one").set("2026-11-15T00:00:00Z");
    expect(reportsSeenStore(storage, "one").get()).toBe("2026-11-15T00:00:00Z");
    expect(reportsSeenStore(storage, "two").get()).toBeNull();
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } } as unknown as Storage;
    expect(reportsSeenStore(broken, "one").get()).toBeNull();
    expect(() => reportsSeenStore(broken, "one").set("2026-11-15T00:00:00Z")).not.toThrow();
  });
});

describe("push support", () => {
  const desktop: PushEnvironment = {
    serviceWorker: true, pushManager: true, notification: true,
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/140", platform: "Linux x86_64", maxTouchPoints: 0, standalone: false,
  };
  const iphone = { ...desktop, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", platform: "iPhone", pushManager: false };

  it("detects supported, unsupported and iOS-not-installed browsers", () => {
    expect(pushSupport(desktop)).toBe("supported");
    expect(pushSupport({ ...desktop, pushManager: false })).toBe("unsupported");
    expect(pushSupport(iphone)).toBe("ios-install");
    expect(pushSupport({ ...iphone, platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh)", maxTouchPoints: 5 })).toBe("ios-install");
    expect(pushSupport({ ...iphone, standalone: true, pushManager: true })).toBe("supported");
  });

  it("compares a subscription's server key with the configured VAPID key", () => {
    const key = "BPq-_w";
    expect([...base64UrlToBytes(key)]).toEqual([4, 250, 190, 255]);
    expect(sameServerKey(base64UrlToBytes(key).buffer as ArrayBuffer, key)).toBe(true);
    expect(sameServerKey(new Uint8Array([4, 250, 190, 0]).buffer, key)).toBe(false);
    expect(sameServerKey(null, key)).toBe(false);
  });
});
