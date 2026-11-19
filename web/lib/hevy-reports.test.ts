import { beforeEach, expect, it, vi } from "vitest";
import { getReportStatus, ReportSettingsError, setReportsEnabled } from "./hevy-reports";
import { MAX_REPORT_ATTEMPTS } from "./workout-report-worker";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/hevy-connection", async (original) => ({
  ...await original<typeof import("@/lib/hevy-connection")>(), storage: () => ({ rpc: mocks.rpc }),
}));

const owner = "00000000-0000-4000-8000-000000000001";
beforeEach(() => { vi.resetAllMocks(); vi.spyOn(console, "error").mockImplementation(() => {}); });

it("normalizes Postgres timestamps to ISO and passes the retry limit", async () => {
  mocks.rpc.mockResolvedValue({ data: {
    enabled: true, status: "working", last_received_at: "2026-11-19T11:00:00.5+01:00",
    last_report: { status: "pending", at: "2026-11-19T10:01:00+00:00", conversation_id: null },
  }, error: null });
  expect(await getReportStatus(owner)).toEqual({
    enabled: true, status: "working", last_received_at: "2026-11-19T10:00:00.500Z",
    last_report: { status: "pending", at: "2026-11-19T10:01:00.000Z", conversation_id: null },
  });
  expect(mocks.rpc).toHaveBeenCalledWith("hevy_report_status", { p_user_id: owner, p_max_attempts: MAX_REPORT_ATTEMPTS });
});

it("returns null (not_oauth) when there is no OAuth connection", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  expect(await getReportStatus(owner)).toBeNull();
  expect(await setReportsEnabled(owner, false)).toBeNull();
});

it.each([
  ["a database error", { data: null, error: { code: "XX000" } }],
  ["an unexpected shape", { data: { enabled: "yes" }, error: null }],
])("throws ReportSettingsError on %s", async (_, reply) => {
  mocks.rpc.mockResolvedValue(reply);
  await expect(getReportStatus(owner)).rejects.toBeInstanceOf(ReportSettingsError);
});

it("writes and reads in one RPC: the returned status is the committed one, with no follow-up read", async () => {
  mocks.rpc.mockResolvedValue({ data: {
    enabled: false, status: "off", last_received_at: null,
    last_report: { status: "delivered", at: "2026-11-19T10:01:00+00:00", conversation_id: "00000000-0000-4000-8000-0000000000c1" },
  }, error: null });
  expect(await setReportsEnabled(owner, false)).toEqual({
    enabled: false, status: "off", last_received_at: null,
    last_report: { status: "delivered", at: "2026-11-19T10:01:00.000Z", conversation_id: "00000000-0000-4000-8000-0000000000c1" },
  });
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(mocks.rpc).toHaveBeenCalledWith("set_hevy_reports_enabled", {
    p_user_id: owner, p_enabled: false, p_max_attempts: MAX_REPORT_ATTEMPTS,
  });
});

it("throws ReportSettingsError when the write RPC fails (nothing committed)", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code: "XX000" } });
  await expect(setReportsEnabled(owner, true)).rejects.toBeInstanceOf(ReportSettingsError);
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
});
