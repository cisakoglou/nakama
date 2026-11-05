"use client";

import { useState, type FormEvent } from "react";
import { z } from "zod";
import { readApiResponse } from "@/lib/api-response";
import { connectionSchema, type HevyConnection } from "@/lib/hevy-types";

export function HevyConnectionForm({ connection, onChanged }: {
  connection: HevyConnection; onChanged: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const showSetup = !connection.connected || replacing;

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const key = apiKey.trim();
    setApiKey("");
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/hevy", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: key }),
      });
      await readApiResponse(response, z.object({ connection: connectionSchema }));
      setReplacing(false);
      onChanged();
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setError(error.message);
    } finally { setBusy(false); }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect Hevy and remove your saved key from Nakama? This does not delete your Hevy workouts or revoke the key in Hevy.")) return;
    setApiKey("");
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/hevy", { method: "DELETE" });
      await readApiResponse(response, z.object({ connection: connectionSchema }));
      onChanged();
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setError(error.message);
    } finally { setBusy(false); }
  }

  return (
    <section aria-labelledby="hevy-heading" className="mt-6 rounded-2xl border border-line p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="hevy-heading" className="text-lg font-semibold">
          {connection.connected
            ? replacing ? "Replace your Hevy key" : "Hevy connected"
            : "Connect your Hevy account"}
        </h2>
        <span className="rounded-full bg-brand-soft px-3 py-1 text-xs font-medium text-brand">
          {connection.connected ? "Connected" : "One-time setup"}
        </span>
      </div>
      {connection.connected && (
        <p className="mt-3 text-sm leading-6 text-ink-muted">
          {replacing
            ? "Your existing connection stays active until the replacement key is checked and saved."
            : "Setup complete. Your connection is saved across visits and devices. Nakama can read your latest workouts when you ask for coaching."}
        </p>
      )}
      {showSetup && (
        <>
          <p id="hevy-setup-help" className="mt-3 text-sm leading-6 text-ink-muted">
            <strong className="text-ink">Hevy Pro is required.</strong>{" "}
            Use your browser, not the Hevy mobile app, for this setup.
            The developer section is on Hevy&apos;s website.
          </p>
          <ol className="mt-5 space-y-6">
            <li className="flex gap-3">
              <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand">1</span>
              <div className="min-w-0 flex-1">
                <h3 className="font-medium">Open Hevy in your browser</h3>
                <p className="mt-1 text-sm leading-6 text-ink-muted">
                  Sign in if asked; your Hevy email can differ from your Nakama email.
                  Keep this tab open.
                </p>
                <a
                  href="https://hevy.com/settings?developer" target="_blank" rel="noopener noreferrer"
                  className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-brand px-4 py-2 text-sm font-semibold text-brand hover:bg-brand-soft focus:outline-none focus:ring-2 focus:ring-brand/40"
                >
                  Open Hevy website
                  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
                    <path d="M11 3h6v6M17 3l-9 9M8 3H3v14h14v-5" />
                  </svg>
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </div>
            </li>
            <li className="flex gap-3">
              <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand">2</span>
              <div className="min-w-0 flex-1">
                <h3 className="font-medium">Copy your API key</h3>
                <p className="mt-1 text-sm leading-6 text-ink-muted">
                  Copy your existing key, or create one if needed.
                  Do not choose &quot;Revoke API Key&quot;.
                </p>
                <figure className="mt-3 rounded-xl border border-line bg-canvas p-3">
                  <div aria-hidden="true" className="rounded-lg border border-line bg-surface px-3 py-2">
                    <span className="text-xs font-medium text-ink-muted">API key</span>
                    <span className="mt-1 block select-none font-mono text-sm text-brand">********</span>
                  </div>
                  <figcaption className="mt-2 text-xs leading-5 text-ink-muted">
                    Illustration only. Copy your real key from Hevy.
                  </figcaption>
                </figure>
              </div>
            </li>
            <li className="flex gap-3">
              <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand">3</span>
              <div className="min-w-0 flex-1">
                <h3 className="font-medium">Paste and connect</h3>
                <p id="hevy-key-help" className="mt-1 text-sm leading-6 text-ink-muted">
                  Your key is checked with Hevy and saved encrypted.
                  Never send it in chat or email.
                </p>
                <form onSubmit={connect} className="mt-3">
                  <label htmlFor="hevy-key" className="text-sm font-medium">
                    {connection.connected ? "Your replacement Hevy API key" : "Your Hevy API key"}
                  </label>
                  <input
                    id="hevy-key" type="password" autoComplete="off" spellCheck={false}
                    aria-describedby="hevy-setup-help hevy-key-help"
                    value={apiKey} onChange={(event) => setApiKey(event.target.value)}
                    maxLength={512} required disabled={busy}
                    className="mt-2 w-full rounded-xl border border-line bg-canvas px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand/40"
                  />
                  <button
                    type="submit" disabled={busy || !apiKey.trim()}
                    className="mt-3 w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold hover:bg-brand-hover disabled:opacity-50"
                  >{busy ? "Checking and saving..." : connection.connected ? "Replace connection" : "Connect Hevy"}</button>
                  {connection.connected && (
                    <button
                      type="button" disabled={busy}
                      onClick={() => { setApiKey(""); setError(null); setReplacing(false); }}
                      className="mt-3 min-h-11 text-sm underline underline-offset-4"
                    >Cancel replacement</button>
                  )}
                </form>
              </div>
            </li>
          </ol>
        </>
      )}
      {connection.connected && !replacing && (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
          <button
            type="button" disabled={busy} onClick={() => { setError(null); setReplacing(true); }}
            className="min-h-11 text-sm underline underline-offset-4"
          >Replace key</button>
          <button type="button" onClick={disconnect} disabled={busy} className="min-h-11 text-sm underline underline-offset-4">
            {busy ? "Disconnecting..." : "Disconnect Hevy"}
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
      <details open={showSetup} className="mt-4">
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Privacy and control</summary>
        <p className="text-sm leading-6 text-ink-muted">
          Your Nakama uses your workouts and saved preferences to give you grounded guidance through Anthropic.
          Your key is encrypted on the server and is never included in the conversation prompt.
          Creating or changing Hevy records requires your approval in chat.
        </p>
        {connection.connected && (
          <p className="mt-3 text-xs leading-5 text-ink-muted">
            Disconnect removes the saved key from Nakama, not your Hevy workouts.
            To revoke the key everywhere, use Hevy developer settings.
          </p>
        )}
      </details>
    </section>
  );
}
