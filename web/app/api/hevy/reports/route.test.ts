import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET, PUT } from "./route";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), get: vi.fn(), set: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/hevy-connection", async (original) => ({
  ...await original<typeof import("@/lib/hevy-connection")>(), storage: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/auth", () => ({ requireBetaUser: mocks.auth }));
vi.mock("@/lib/hevy-reports", async (original) => ({
  ...await original<typeof import("@/lib/hevy-reports")>(), getReportStatus: mocks.get, setReportsEnabled: mocks.set,
}));

const owner = "00000000-0000-4000-8000-000000000001";
const status = { enabled: true, status: "working", last_received_at: "2026-11-19T10:00:00.000Z",
  last_report: { status: "delivered", at: "2026-11-19T10:01:00.000Z", conversation_id: "00000000-0000-4000-8000-0000000000c1" } };
const put = (body: unknown, origin = "https://nakama.test") => new NextRequest("https://nakama.test/api/hevy/reports", {
  method: "PUT", headers: { origin, "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_ORIGIN", "https://nakama.test");
  mocks.auth.mockResolvedValue({
    ok: true, user: { id: owner, email: "one@example.test" },
    session: { json: (body: unknown, code = 200) => NextResponse.json(body, { status: code }) },
  });
  mocks.get.mockResolvedValue(status);
  mocks.set.mockResolvedValue({ ...status, enabled: false, status: "off" });
});
afterEach(() => { vi.unstubAllEnvs(); });

it("returns the signed-in user's report status, uncached", async () => {
  const response = await GET(new NextRequest("https://nakama.test/api/hevy/reports"));
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.json()).toEqual(status);
  expect(mocks.get).toHaveBeenCalledWith(owner);
});

it("answers not_oauth for API-key or missing connections", async () => {
  mocks.get.mockResolvedValue(null);
  mocks.set.mockResolvedValue(null);
  for (const response of [await GET(new NextRequest("https://nakama.test/api/hevy/reports")), await PUT(put({ enabled: false }))]) {
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "not_oauth" });
  }
});

it.each([GET, PUT])("requires a verified beta user (%#)", async (handler) => {
  mocks.auth.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Please sign in." }, { status: 401 }) });
  const response = await handler(handler === GET ? new NextRequest("https://nakama.test/api/hevy/reports") : put({ enabled: true }));
  expect(response.status).toBe(401);
  expect(mocks.get).not.toHaveBeenCalled();
  expect(mocks.set).not.toHaveBeenCalled();
});

it("updates only the verified user's preference and returns the new status", async () => {
  const response = await PUT(put({ enabled: false }));
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.json()).toMatchObject({ enabled: false, status: "off" });
  expect(mocks.set).toHaveBeenCalledWith(owner, false);
});

it.each([
  ["missing origin", put({ enabled: true }, "")],
  ["cross-site origin", put({ enabled: true }, "https://evil.test")],
])("rejects %s before authenticating", async (_, req) => {
  expect((await PUT(req)).status).toBe(403);
  expect(mocks.auth).not.toHaveBeenCalled();
  expect(mocks.set).not.toHaveBeenCalled();
});

it.each([
  ["invalid JSON", "{nope"],
  ["a string", { enabled: "false" }],
  ["missing enabled", {}],
  ["an extra field", { enabled: true, user_id: "someone-else" }],
  ["null", null],
])("rejects %s with 400", async (_, body) => {
  expect((await PUT(put(body))).status).toBe(400);
  expect(mocks.set).not.toHaveBeenCalled();
});

it("returns 503 when settings storage is unavailable", async () => {
  const { ReportSettingsError } = await import("@/lib/hevy-reports");
  mocks.get.mockRejectedValue(new ReportSettingsError("Report settings are unavailable. Please try again."));
  expect((await GET(new NextRequest("https://nakama.test/api/hevy/reports"))).status).toBe(503);
});

it("PUT answers from the single write RPC: success returns the committed state, failure means nothing saved", async () => {
  const actual = await vi.importActual<typeof import("@/lib/hevy-reports")>("@/lib/hevy-reports");
  mocks.set.mockImplementation(actual.setReportsEnabled);
  vi.spyOn(console, "error").mockImplementation(() => {});
  const committed = { ...status, enabled: false, status: "off" };
  mocks.rpc.mockResolvedValueOnce({ data: committed, error: null });
  const ok = await PUT(put({ enabled: false }));
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual(committed);
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(mocks.rpc.mock.calls[0][0]).toBe("set_hevy_reports_enabled");
  expect(mocks.get).not.toHaveBeenCalled();

  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "57014" } });
  expect((await PUT(put({ enabled: false }))).status).toBe(503);
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
});
