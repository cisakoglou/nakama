"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { readApiResponse } from "@/lib/api-response";

const statusSchema = z.object({
  webhook: z.object({ configured: z.boolean(), url: z.string().url(), created_at: z.string().nullable().optional() }),
});
const createdSchema = z.object({
  webhook: z.object({ configured: z.literal(true), url: z.string().url(), authorization: z.string().startsWith("Bearer ") }),
});

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3">
      <p className="text-sm font-medium">{label}</p>
      <div className="mt-1 flex gap-2">
        <input readOnly value={value} aria-label={label} onFocus={(event) => event.target.select()}
          className="w-full rounded-xl border border-line bg-canvas px-3 py-2 font-mono text-xs" />
        <button type="button" className="rounded-xl border border-line px-3 text-sm"
          onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); }}
        >{copied ? "Copied" : "Copy"}</button>
      </div>
    </div>
  );
}

export function WorkoutReportWebhook() {
  const [status, setStatus] = useState<z.infer<typeof statusSchema>["webhook"] | null>(null);
  const [created, setCreated] = useState<z.infer<typeof createdSchema>["webhook"] | null>(null);
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

  return (
    <section className="mt-6 rounded-2xl border border-line p-5">
      <h2 className="text-lg font-semibold">Post-workout reports</h2>
      <p className="mt-3 text-sm leading-6 text-ink-muted">
        When you save a new workout in Hevy, Nakama adds a report to your chats comparing it with your recent similar
        workouts. Set this up in Hevy developer settings under Webhooks.
      </p>
      {status && <p className="mt-3 text-sm">{status.configured ? "Status: set up" : "Status: not set up"}</p>}
      {created && (
        <div className="mt-3 rounded-xl border border-line bg-canvas p-4">
          <p className="text-sm leading-6">
            Copy both values into Hevy now. The authorization header is shown only once.
          </p>
          <CopyField label="Webhook URL" value={created.url} />
          <CopyField label="Authorization header" value={created.authorization} />
        </div>
      )}
      <button type="button" onClick={() => change("PUT")} disabled={busy || !status}
        className="mt-4 w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold hover:bg-brand-hover disabled:opacity-50"
      >{busy ? "Please wait..." : status?.configured ? "Create a new authorization header" : "Set up workout reports"}</button>
      {status?.configured && (
        <button type="button" onClick={() => change("DELETE")} disabled={busy}
          className="mt-3 min-h-11 text-sm underline underline-offset-4">Turn off workout reports</button>
      )}
      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
      <p className="mt-4 text-xs leading-5 text-ink-muted">
        Replacing or disconnecting your Hevy key turns reports off until you set them up again. To stop Hevy sending
        events entirely, also remove the webhook in Hevy.
      </p>
    </section>
  );
}
