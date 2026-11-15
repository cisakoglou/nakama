"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { readApiResponse } from "@/lib/api-response";

const statusSchema = z.object({
  webhook: z.object({
    configured: z.boolean(),
    url: z.string().url(),
    created_at: z.string().nullable().optional(),
    last_received_at: z.string().nullable().optional(),
  }),
});
const createdSchema = z.object({
  webhook: z.object({ configured: z.literal(true), url: z.string().url(), authorization: z.string().startsWith("Bearer ") }),
});

export type WebhookStatus = z.infer<typeof statusSchema>["webhook"];
export type CreatedWebhook = z.infer<typeof createdSchema>["webhook"];

export type WebhookStatusSummary = { state: "not-set-up" | "waiting" | "working"; text: string };

function defaultFormatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Pure status text for the webhook status line. */
export function describeWebhookStatus(
  status: Pick<WebhookStatus, "configured" | "last_received_at">,
  formatDate: (iso: string) => string = defaultFormatDate,
): WebhookStatusSummary {
  if (!status.configured) return { state: "not-set-up", text: "Not set up" };
  if (!status.last_received_at) {
    return { state: "waiting", text: "Set up, waiting for your first workout from Hevy" };
  }
  return { state: "working", text: `Working, last workout received ${formatDate(status.last_received_at)}` };
}

const COPY_FAILED = "Copy failed, select and copy manually";

export function CopyField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      setFailed(false);
      setMessage(`${label} copied`);
    } catch {
      inputRef.current?.focus();
      inputRef.current?.select();
      setFailed(true);
      setMessage(COPY_FAILED);
    }
  }

  return (
    <div className="mt-3">
      <label htmlFor={`webhook-${label.replace(/\W+/g, "-").toLowerCase()}`} className="text-sm font-medium">{label}</label>
      {hint && <p className="mt-1 text-xs leading-5 text-ink-muted">{hint}</p>}
      <div className="mt-1 flex gap-2">
        <input
          ref={inputRef} readOnly value={value} onFocus={(event) => event.target.select()}
          id={`webhook-${label.replace(/\W+/g, "-").toLowerCase()}`}
          className="min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-brand/40"
        />
        <button type="button" onClick={copy}
          className="min-h-11 shrink-0 rounded-xl border border-brand px-4 text-sm font-semibold text-brand hover:bg-brand-soft focus:outline-none focus:ring-2 focus:ring-brand/40"
        >{message && !failed ? "Copied" : "Copy"}<span className="sr-only"> {label}</span></button>
      </div>
      <p aria-live="polite" role="status" className={`mt-1 min-h-5 text-xs ${failed ? "text-red-700" : "text-ink-muted"}`}>{message}</p>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children?: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand">{n}</span>
      <div className="min-w-0 flex-1">
        <h3 className="font-medium">{title}</h3>
        {children}
      </div>
    </li>
  );
}

const hint = "mt-1 text-sm leading-6 text-ink-muted";

export function WebhookSetupView({ status, created, busy, error, onGenerate, onTurnOff, onRefresh }: {
  status: WebhookStatus | null;
  created: CreatedWebhook | null;
  busy: boolean;
  error: string | null;
  onGenerate: () => void;
  onTurnOff: () => void;
  onRefresh: () => void;
}) {
  const summary = status ? describeWebhookStatus(status) : null;
  const showSteps = !!status && (!status.configured || !!created);
  const dot = summary?.state === "working" ? "bg-green-600" : summary?.state === "waiting" ? "bg-amber-500" : "bg-ink-muted";

  return (
    <section aria-labelledby="webhook-heading" className="mt-6 rounded-2xl border border-line p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="webhook-heading" className="text-lg font-semibold">Post-workout reports</h2>
        <span className="rounded-full bg-brand-soft px-3 py-1 text-xs font-medium text-brand">Hevy Pro webhook</span>
      </div>
      <p className="mt-3 text-sm leading-6 text-ink-muted">
        When you save a new workout in Hevy, Nakama adds a report to your chats comparing it with your recent similar workouts.
      </p>

      {summary && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <p aria-live="polite" role="status" className="flex items-center gap-2 text-sm">
            <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-full ${dot}`} />
            <span><span className="font-medium">Status:</span> {summary.text}</span>
          </p>
          {status?.configured && (
            <button type="button" onClick={onRefresh} disabled={busy}
              className="min-h-11 text-sm underline underline-offset-4 disabled:opacity-50">Check again</button>
          )}
        </div>
      )}

      {showSteps && (
        <>
          <p className="mt-3 text-sm leading-6 text-ink-muted">
            <strong className="text-ink">Hevy Pro is required.</strong>{" "}
            Use your browser, not the Hevy mobile app, for this setup.
          </p>
          <ol className="mt-5 space-y-6">
            <Step n={1} title="Generate your webhook details">
              <p className={hint}>
                {created ? "Done. Your details are below." : "Nakama creates a webhook URL and an authorization header for you."}
              </p>
              {!created && (
                <button type="button" onClick={onGenerate} disabled={busy}
                  className="mt-3 w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 sm:w-auto"
                >{busy ? "Please wait..." : "Generate webhook details"}</button>
              )}
            </Step>
            <Step n={2} title="Open Hevy developer settings">
              <p className={hint}>Sign in if asked, then find <strong className="text-ink">Webhooks</strong>. Keep this tab open.</p>
              <a href="https://hevy.com/settings?developer" target="_blank" rel="noopener noreferrer"
                className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-brand px-4 py-2 text-sm font-semibold text-brand hover:bg-brand-soft focus:outline-none focus:ring-2 focus:ring-brand/40">
                Open Hevy website
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
                  <path d="M11 3h6v6M17 3l-9 9M8 3H3v14h14v-5" />
                </svg>
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </Step>
            <Step n={3} title="Paste the Webhook URL">
              {created
                ? <CopyField label="Webhook URL" value={created.url} />
                : <p className={hint}>Appears here after step 1.</p>}
            </Step>
            <Step n={4} title="Paste the Authorization header">
              {created ? (
                <>
                  <p className="mt-1 rounded-lg bg-brand-soft px-3 py-2 text-xs leading-5 text-ink">
                    <strong>Shown only once.</strong> Copy it now. Nakama keeps only a hash and cannot show it again.
                  </p>
                  <CopyField label="Authorization header" value={created.authorization} />
                </>
              ) : <p className={hint}>Appears here after step 1. Paste the whole value, including &quot;Bearer&quot;.</p>}
            </Step>
            <Step n={5} title="Save in Hevy">
              <p className={hint}>Save the webhook in Hevy before leaving that page.</p>
            </Step>
            <Step n={6} title="Log your next workout">
              <p className={hint}>
                A report appears in your chats. Only workouts saved after setup are reported.
              </p>
            </Step>
          </ol>
        </>
      )}

      {status?.configured && (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
          <button type="button" onClick={onGenerate} disabled={busy}
            className="min-h-11 text-sm underline underline-offset-4 disabled:opacity-50"
          >{busy ? "Please wait..." : "Lost it? Create a new header"}</button>
          <button type="button" onClick={onTurnOff} disabled={busy}
            className="min-h-11 text-sm underline underline-offset-4 disabled:opacity-50">Turn off workout reports</button>
        </div>
      )}
      {status?.configured && (
        <p className="mt-1 text-xs leading-5 text-ink-muted">
          A new header replaces the old one right away. Paste it into Hevy again.
        </p>
      )}
      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
      <p className="mt-4 text-xs leading-5 text-ink-muted">
        Replacing or disconnecting your Hevy key turns reports off until you set them up again. To stop Hevy sending
        events entirely, also remove the webhook in Hevy.
      </p>
    </section>
  );
}

export function WorkoutReportWebhook() {
  const [status, setStatus] = useState<WebhookStatus | null>(null);
  const [created, setCreated] = useState<CreatedWebhook | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus((await readApiResponse(await fetch("/api/hevy/webhook-token"), statusSchema)).webhook);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setError(error.message);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function change(method: "PUT" | "DELETE") {
    if (method === "PUT" && status?.configured && !window.confirm(
      "Create a new authorization header? The current one stops working, so you must update it in Hevy.",
    )) return;
    if (method === "DELETE" && !window.confirm("Turn off workout reports? Hevy webhook calls will be rejected until you set them up again.")) return;
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const response = await fetch("/api/hevy/webhook-token", { method });
      if (method === "PUT") setCreated((await readApiResponse(response, createdSchema)).webhook);
      else await readApiResponse(response, statusSchema);
      await load();
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setError(error.message);
    } finally { setBusy(false); }
  }

  async function refresh() {
    setBusy(true);
    setError(null);
    try { await load(); } finally { setBusy(false); }
  }

  return (
    <WebhookSetupView
      status={status} created={created} busy={busy} error={error}
      onGenerate={() => void change("PUT")} onTurnOff={() => void change("DELETE")} onRefresh={() => void refresh()}
    />
  );
}

