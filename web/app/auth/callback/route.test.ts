import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ createRequestClient: vi.fn(), exchange: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createRequestClient: mocks.createRequestClient }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.exchange.mockResolvedValue({ error: null });
  mocks.createRequestClient.mockReturnValue({
    client: { auth: { exchangeCodeForSession: mocks.exchange } },
    redirect: (target: URL) => NextResponse.redirect(target),
  });
});

afterEach(() => { vi.unstubAllEnvs(); });

it("returns to the configured HTTPS origin behind a proxy, not an internal or forwarded host", async () => {
  vi.stubEnv("APP_ORIGIN", "https://nakama.test");
  const response = await GET(new NextRequest("http://0.0.0.0:3002/auth/callback?code=test-code", {
    headers: { "x-forwarded-host": "other.test" },
  }));
  expect(response.headers.get("location")).toBe("https://nakama.test/");
  expect(mocks.exchange).toHaveBeenCalledWith("test-code");
});

it("exchanges a Google or email-link PKCE code and ignores external redirect input", async () => {
  const response = await GET(new NextRequest("https://nakama.test/auth/callback?code=test-code&next=https://other.test"));
  expect(mocks.exchange).toHaveBeenCalledWith("test-code");
  expect(response.headers.get("location")).toBe("https://nakama.test/");
});

it("redirects incomplete sign-in back to a retryable error", async () => {
  const response = await GET(new NextRequest("https://nakama.test/auth/callback"));
  expect(response.headers.get("location")).toBe("https://nakama.test/?auth_error=sign_in_failed");
  expect(mocks.exchange).not.toHaveBeenCalled();
});

it("does not treat a failed exchange as a successful sign-in", async () => {
  mocks.exchange.mockResolvedValue({ error: { message: "Invalid code" } });
  const response = await GET(new NextRequest("https://nakama.test/auth/callback?code=bad"));
  expect(response.headers.get("location")).toBe("https://nakama.test/?auth_error=sign_in_failed");
});

it("lets an expired or already-used email link be retried without exchanging a code", async () => {
  const response = await GET(new NextRequest("https://nakama.test/auth/callback?error=access_denied&error_code=otp_expired"));
  expect(response.headers.get("location")).toBe("https://nakama.test/?auth_error=link_expired");
  expect(mocks.exchange).not.toHaveBeenCalled();
});

it("does not reflect provider-supplied error text or redirect targets", async () => {
  const response = await GET(new NextRequest("https://nakama.test/auth/callback?error_description=Untrusted+message&next=https://other.test"));
  expect(response.headers.get("location")).toBe("https://nakama.test/?auth_error=sign_in_failed");
});
