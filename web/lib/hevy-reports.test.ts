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
  mocks.rpc.mockResolvedValue({ data: false, error: null });
  expect(await setReportsEnabled(owner, false)).toBeNull();
});

it.each([
  ["a database error", { data: null, error: { code: "XX000" } }],
  ["an unexpected shape", { data: { enabled: "yes" }, error: null }],
])("throws ReportSettingsError on %s", async (_, reply) => {
  mocks.rpc.mockResolvedValue(reply);
  await expect(getReportStatus(owner)).rejects.toBeInstanceOf(ReportSettingsError);
});
