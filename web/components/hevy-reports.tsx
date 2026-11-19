"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchReports, relativeTime, saveReportsEnabled, type ReportsState } from "@/lib/hevy-connect-client";

type LastReport = NonNullable<ReportsState["last_report"]>;

export function describeReportsStatus(state: ReportsState, now: number = Date.now()) {
  if (state.status === "off") return { tone: "off", text: "Off. No new reports will be created." } as const;
  if (state.status === "waiting") return { tone: "waiting", text: "Waiting for your next workout" } as const;
  return {
    tone: "working",
    text: state.last_received_at ? `Working. Last workout received ${relativeTime(state.last_received_at, now)}` : "Working",
  } as const;
}

function lastReportLine(report: LastReport, now: number) {
  const when = relativeTime(report.at, now);
  if (report.status === "delivered") return `Last report delivered ${when}.`;
  if (report.status === "pending") return `A report is being prepared (started ${when}).`;
  return `The last report could not be created (${when}). The next workout will try again.`;
}

/** Report controls for OAuth connections. All state comes from GET/PUT /api/hevy/reports. */
export function HevyReportsView({ state, unavailable, busy, error, reconnectRequired, now = Date.now(), onToggle, onRetry }: {
  state: ReportsState | null;
  unavailable: boolean;
  busy: boolean;
  error: string | null;
  reconnectRequired: boolean;
  now?: number;
  onToggle: (enabled: boolean) => void;
  onRetry: () => void;
}) {
  const summary = state ? describeReportsStatus(state, now) : null;
  const dot = summary?.tone === "working" ? "bg-green-600" : summary?.tone === "waiting" ? "bg-amber-500" : "bg-ink-muted";
  return (
    <section aria-labelledby="hevy-reports-heading" className="mt-6 rounded-2xl border border-line p-5">
      <h2 id="hevy-reports-heading" className="text-lg font-semibold">Post-workout reports</h2>
      <p className="mt-3 text-sm leading-6 text-ink-muted">
        When you save a new workout in Hevy, Nakama adds a report to your chats comparing it with your recent similar
        workouts. Reports are created whether or not you turn on notifications.
      </p>
      {reconnectRequired && (
        <p className="mt-3 text-sm leading-6 text-ink-muted">Reports pause until you reconnect Hevy.</p>
      )}
      {unavailable && !state && (
        <div className="mt-3 rounded-xl border border-line bg-canvas p-4 text-sm leading-6">
          <p role="status">Report status is unavailable right now. Your setting has not changed.</p>
          <button type="button" onClick={onRetry} disabled={busy}
            className="mt-2 min-h-11 text-sm underline underline-offset-4 disabled:opacity-50">Check again</button>
        </div>
      )}
      {state && summary && (
        <>
          <div className="mt-4 flex items-center justify-between gap-4">
            <span id="hevy-reports-label" className="text-sm font-medium">Automatic workout reports</span>
            <button
              type="button" role="switch" aria-checked={state.enabled} aria-labelledby="hevy-reports-label"
              disabled={busy} onClick={() => onToggle(!state.enabled)}
              className={`relative inline-flex h-11 w-16 shrink-0 items-center rounded-full border border-line px-1 focus:outline-none focus:ring-2 focus:ring-brand/40 disabled:opacity-50 ${state.enabled ? "bg-brand" : "bg-canvas"}`}
            >
              <span aria-hidden="true" className={`h-8 w-8 rounded-full bg-surface shadow transition-transform ${state.enabled ? "translate-x-6" : ""}`} />
              <span className="sr-only">{state.enabled ? "On" : "Off"}</span>
            </button>
          </div>
          <p aria-live="polite" role="status" className="mt-3 flex items-center gap-2 text-sm">
            <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
            <span><span className="font-medium">Status:</span> {summary.text}</span>
          </p>
          {state.last_report && (
            <p className="mt-2 text-sm leading-6 text-ink-muted">
              {lastReportLine(state.last_report, now)}
              {state.last_report.status === "delivered" && state.last_report.conversation_id && (
                <> <a href={`/?chat=${state.last_report.conversation_id}`}
                  className="inline-flex min-h-11 items-center font-medium text-brand underline underline-offset-4">Open the report</a></>
              )}
            </p>
          )}
        </>
      )}
      <p aria-live="polite" className="empty:hidden">
        {error && <span role="alert" className="mt-3 block text-sm text-red-700">{error}</span>}
      </p>
      <p className="mt-4 text-xs leading-5 text-ink-muted">
        Only workouts saved after you connect are reported. You can turn reports off or on at any time.
      </p>
    </section>
  );
}

export function HevyReports({ reconnectRequired }: { reconnectRequired: boolean }) {
  const [state, setState] = useState<ReportsState | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await fetchReports());
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function toggle(enabled: boolean) {
    setBusy(true);
    setError(null);
    try {
      setState(await saveReportsEnabled(enabled));
    } catch {
      setError("Could not save that change. Your report setting is unchanged.");
    } finally { setBusy(false); }
  }

  async function retry() {
    setBusy(true);
    try { await load(); } finally { setBusy(false); }
  }

  return (
    <HevyReportsView
      state={state} unavailable={unavailable} busy={busy} error={error} reconnectRequired={reconnectRequired}
      onToggle={(enabled) => void toggle(enabled)} onRetry={() => void retry()}
    />
  );
}
