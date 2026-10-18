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
    <section className="mt-6 rounded-2xl border border-line p-5">
      <h2 className="text-lg font-semibold">{connection.connected ? "Hevy is connected" : "Connect your Hevy account"}</h2>
      <p className="mt-3 text-sm leading-6 text-ink-muted">
        You need Hevy Pro. Open{" "}
        <a href="https://hevy.com/settings?developer" target="_blank" rel="noopener noreferrer" className="underline">
          Hevy developer settings
        </a>{" "}
        and copy your API key. Your Hevy email can differ from your Nakama email.
      </p>
      <p className="mt-3 text-sm leading-6 text-ink-muted">
        Nakama uses your workouts and saved preferences to coach you through Anthropic.
        Your key is encrypted on the server and is never included in the coaching prompt.
        Creating or changing Hevy records requires your approval in chat.
      </p>
      <form onSubmit={connect} className="mt-4">
        <label htmlFor="hevy-key" className="text-sm font-medium">
          {connection.connected ? "Replace your Hevy API key" : "Your Hevy API key"}
        </label>
        <input
          id="hevy-key" type="password" autoComplete="off" spellCheck={false}
          value={apiKey} onChange={(event) => setApiKey(event.target.value)}
          maxLength={512} required disabled={busy}
          className="mt-2 w-full rounded-xl border border-line bg-canvas px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand/40"
        />
        <button
          type="submit" disabled={busy || !apiKey.trim()}
          className="mt-4 w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold hover:bg-brand-hover disabled:opacity-50"
        >{busy ? "Please wait..." : connection.connected ? "Replace connection" : "Connect Hevy and start coaching"}</button>
      </form>
      {connection.connected && (
        <button type="button" onClick={disconnect} disabled={busy} className="mt-3 min-h-11 text-sm underline underline-offset-4">
          Disconnect Hevy
        </button>
      )}
      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
      <p className="mt-4 text-xs leading-5 text-ink-muted">
        Disconnect removes the saved key from Nakama. To revoke it everywhere, also revoke or rotate it in Hevy developer settings.
      </p>
    </section>
  );
}
