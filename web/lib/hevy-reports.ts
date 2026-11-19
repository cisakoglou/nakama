import "server-only";
import { z } from "zod";
import { HevyConnectionError, storage } from "@/lib/hevy-connection";
import { MAX_REPORT_ATTEMPTS } from "@/lib/workout-report-worker";

/** OAuth report preference + status (REPORTS-CONTRACT.md). API-key connections keep the personal webhook controls. */
export const reportStatusSchema = z.object({
  enabled: z.boolean(),
  status: z.enum(["off", "waiting", "working"]),
  last_received_at: z.string().nullable(),
  last_report: z.object({
    status: z.enum(["pending", "delivered", "failed"]),
    at: z.string(),
    conversation_id: z.string().uuid().nullable(),
  }).strict().nullable(),
}).strict();
export type ReportStatus = z.infer<typeof reportStatusSchema>;

export class ReportSettingsError extends Error {}

function failure(code: string) {
  console.error("Hevy report settings database operation failed", { code });
  return new ReportSettingsError("Report settings are unavailable. Please try again.");
}

function db() {
  try {
    return storage();
  } catch (error) {
    if (!(error instanceof HevyConnectionError)) throw error;
    throw new ReportSettingsError(error.message);
  }
}

// PostgREST returns timestamptz inside jsonb in Postgres text form; normalize to ISO for the contract.
const iso = (value: string | null) => value === null ? null : new Date(value).toISOString();

/** Null when the user has no OAuth connection (contract code not_oauth). */
export async function getReportStatus(userId: string): Promise<ReportStatus | null> {
  const { data, error } = await db().rpc("hevy_report_status", { p_user_id: userId, p_max_attempts: MAX_REPORT_ATTEMPTS });
  if (error) throw failure(error.code);
  if (data === null) return null;
  const parsed = reportStatusSchema.safeParse(data);
  if (!parsed.success) throw failure("invalid_status");
  const status = parsed.data;
  return {
    ...status,
    last_received_at: iso(status.last_received_at),
    last_report: status.last_report && { ...status.last_report, at: iso(status.last_report.at)! },
  };
}

export async function setReportsEnabled(userId: string, enabled: boolean): Promise<ReportStatus | null> {
  const { data, error } = await db().rpc("set_hevy_reports_enabled", { p_user_id: userId, p_enabled: enabled });
  if (error) throw failure(error.code);
  if (!data) return null;
  return getReportStatus(userId);
}
