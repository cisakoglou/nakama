import { z } from "zod";

/** Browser-side helpers for the Connect Hevy journey. No token or provider logic lives here. */

export const OAUTH_ERROR_CODES = [
  "access_denied", "invalid_state", "account_in_use", "account_mismatch", "connection_changed",
  "migration_required", "missing_scope", "not_eligible", "provider_unavailable", "configuration_unavailable",
  "reconnect_required", "refresh_busy", "signed_out",
] as const;
export type OAuthErrorCode = (typeof OAUTH_ERROR_CODES)[number] | "unknown";

const MESSAGES: Record<OAuthErrorCode, string> = {
  access_denied: "You cancelled the approval in Hevy, so nothing changed. You can connect whenever you are ready.",
  invalid_state: "That approval link expired or was opened in a different browser. Nothing changed. Start again from this browser.",
  account_in_use: "That Hevy account is already connected to a different Nakama account. Nothing changed. Use another Hevy account, or disconnect it from the other Nakama account first.",
  account_mismatch: "That is a different Hevy account from the one already connected here. Nothing changed. Sign in to the same Hevy account to reconnect.",
  connection_changed: "Your Hevy connection changed while you were approving. Nothing was overwritten. Check the current state below and try again.",
  migration_required: "Moving an existing API-key connection to a Hevy login is not available yet. Your current connection keeps working.",
  missing_scope: "Hevy did not grant all the access Nakama needs. Nothing changed. Try again and keep every requested permission on.",
  not_eligible: "Hevy did not allow this account to be connected. Nothing changed.",
  provider_unavailable: "Hevy is not available right now. Nothing changed. Try again in a few minutes.",
  configuration_unavailable: "Connecting with Hevy is not available on this Nakama server right now. Nothing changed.",
  reconnect_required: "Your Hevy approval is no longer valid. Reconnect to continue.",
  refresh_busy: "Hevy is busy refreshing your connection. Try again in a moment.",
  signed_out: "You came back from Hevy in a browser where you are not signed in to Nakama. Nothing changed. Open Nakama where you are signed in (on iPhone, the home-screen app) and connect from there.",
  unknown: "Something went wrong while connecting to Hevy. Nothing changed. Try again.",
};

/** Codes where retrying the same action cannot help, so no "Try again" is offered. */
const NO_RETRY = new Set<OAuthErrorCode>(["migration_required", "configuration_unavailable"]);

export function oauthErrorCode(value: string | null | undefined): OAuthErrorCode {
  return (OAUTH_ERROR_CODES as readonly string[]).includes(value ?? "") ? (value as OAuthErrorCode) : "unknown";
}

export function oauthErrorMessage(code: OAuthErrorCode) {
  return MESSAGES[code];
}

export function canRetryOAuth(code: OAuthErrorCode) {
  return !NO_RETRY.has(code);
}

export type OAuthReturn = { kind: "connected" } | { kind: "error"; code: OAuthErrorCode };

/** Reads `?hevy_oauth=...` from a location search string. The value is a hint only, never proof. */
export function readOAuthReturn(search: string): OAuthReturn | null {
  const params = new URLSearchParams(search);
  const result = params.get("hevy_oauth");
  if (result === "connected") return { kind: "connected" };
  if (result === "error") return { kind: "error", code: oauthErrorCode(params.get("code")) };
  return null;
}

/** The current URL without the OAuth return parameters, for history.replaceState. */
export function withoutOAuthParams(href: string) {
  const url = new URL(href);
  url.searchParams.delete("hevy_oauth");
  url.searchParams.delete("code");
  return `${url.pathname}${url.search}${url.hash}`;
}

const startSchema = z.object({ authorization_url: z.string().url().refine((value) => value.startsWith("https://"), "must be https") });
const errorBodySchema = z.object({ error: z.string().optional(), code: z.string().optional() });

export class OAuthStartError extends Error {
  constructor(public readonly code: OAuthErrorCode, message: string) { super(message); }
}

/** POST /api/hevy/oauth/start (same-origin) and return the URL to navigate to. Never disconnects anything. */
export async function startHevyOAuth(fetchFn: typeof fetch = fetch): Promise<string> {
  let response: Response;
  try {
    response = await fetchFn("/api/hevy/oauth/start", { method: "POST" });
  } catch {
    throw new OAuthStartError("unknown", "Could not reach Nakama. Check your connection and try again.");
  }
  let body: unknown = null;
  try { body = await response.json(); } catch { /* handled below */ }
  if (!response.ok) {
    const parsed = errorBodySchema.safeParse(body);
    const code = oauthErrorCode(parsed.success ? parsed.data.code : null);
    throw new OAuthStartError(code, code === "unknown" && parsed.success && parsed.data.error
      ? parsed.data.error : oauthErrorMessage(code));
  }
  const parsed = startSchema.safeParse(body);
  if (!parsed.success) throw new OAuthStartError("unknown", oauthErrorMessage("unknown"));
  return parsed.data.authorization_url;
}

export const reportsSchema = z.object({
  enabled: z.boolean(),
  status: z.enum(["off", "waiting", "working"]),
  last_received_at: z.string().nullable(),
  last_report: z.object({
    status: z.enum(["pending", "delivered", "failed"]),
    at: z.string(),
    conversation_id: z.string().nullable(),
  }).nullable(),
});
export type ReportsState = z.infer<typeof reportsSchema>;

export async function fetchReports(fetchFn: typeof fetch = fetch): Promise<ReportsState> {
  const response = await fetchFn("/api/hevy/reports", { cache: "no-store" });
  const parsed = reportsSchema.safeParse(await response.json());
  if (!response.ok || !parsed.success) throw new Error("report status unavailable");
  return parsed.data;
}

export async function saveReportsEnabled(enabled: boolean, fetchFn: typeof fetch = fetch): Promise<ReportsState> {
  const response = await fetchFn("/api/hevy/reports", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }),
  });
  const parsed = reportsSchema.safeParse(await response.json());
  if (!response.ok || !parsed.success) throw new Error("report setting not saved");
  return parsed.data;
}

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago"; older or unparseable values fall back to a date. */
export function relativeTime(iso: string, now: number = Date.now()) {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  const unit = (value: number, name: string) => `${value} ${name}${value === 1 ? "" : "s"} ago`;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return unit(Math.floor(seconds / 60), "minute");
  if (seconds < 86400) return unit(Math.floor(seconds / 3600), "hour");
  if (seconds < 7 * 86400) return unit(Math.floor(seconds / 86400), "day");
  return new Date(time).toLocaleDateString(undefined, { dateStyle: "medium" });
}
