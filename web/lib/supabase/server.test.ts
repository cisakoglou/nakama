import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRequestClient } from "./server";
import { getSupabaseConfig, SupabaseConfigurationError } from "./config";

const mocks = vi.hoisted(() => ({ createServerClient: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_example");
});
afterEach(() => { vi.unstubAllEnvs(); });

it.each([undefined, "", "sb_secret_do_not_use", "legacy-key"])("rejects missing or non-public keys (%j)", (key) => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", key);
  expect(getSupabaseConfig).toThrow(SupabaseConfigurationError);
});

it("preserves separate refreshed cookies and disables caching on JSON and redirects", () => {
  mocks.createServerClient.mockImplementation((_url, _key, options) => {
    options.cookies.setAll([
      { name: "sb-test.0", value: "first", options: { path: "/", sameSite: "lax", secure: true } },
      { name: "sb-test.1", value: "second", options: { path: "/", sameSite: "lax", secure: true } },
    ], { "Cache-Control": "no-store", Pragma: "no-cache" });
    return {};
  });
  const request = new NextRequest("https://nakama.test/api/account");
  const session = createRequestClient(request);
  for (const response of [session.json({ ok: true }), session.redirect(new URL("https://nakama.test/"))]) {
    expect(response.cookies.get("sb-test.0")?.value).toBe("first");
    expect(response.cookies.get("sb-test.1")?.value).toBe("second");
    expect(response.headers.getSetCookie()).toHaveLength(2);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
  }
  expect(request.cookies.get("sb-test.0")?.value).toBe("first");
});
