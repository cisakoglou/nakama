"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

export function SignInForm({ message, onRefresh }: { message?: string; onRefresh: () => void }) {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(message ?? null);

  async function sendLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const { error } = await createClient().auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
      setSentTo(normalizedEmail);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function signInWithGoogle() {
    setBusy(true);
    setError(null);
    try {
      const { error } = await createClient().auth.signInWithOAuth({
        provider: "google", options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setError(error.message);
      setBusy(false);
    }
  }

  const inputClass = "mt-2 w-full rounded-xl border border-line bg-canvas px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand/40";
  const buttonClass = "mt-4 w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">Your training companion</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Welcome to Nakama</h1>
      <p className="mt-3 text-sm leading-6 text-ink-muted">
        Use the email on your beta invitation. Your Nakama account is separate from your Hevy login.
      </p>
      <button
        onClick={signInWithGoogle} disabled={busy}
        className="mt-6 w-full rounded-xl border border-line px-4 py-3 text-sm font-semibold hover:bg-canvas disabled:opacity-50"
      >Continue with Google</button>
      <p className="my-5 text-center text-xs text-ink-muted">or sign in with an email link</p>
      {sentTo ? (
        <div>
          <h2 className="font-semibold">Check your inbox</h2>
          <p role="status" className="mt-2 break-words text-sm leading-6 text-ink-muted">
            If this address is invited, a sign-in link has been sent to {sentTo}.
          </p>
          <p className="mt-3 text-sm leading-6 text-ink-muted">
            Open the link in the same browser on this device. Each link can only be used once.
          </p>
          <button type="button" onClick={onRefresh} disabled={busy} className={buttonClass}>
            I&apos;ve opened the link
          </button>
          <button
            type="button" disabled={busy} className="mt-4 min-h-11 text-sm underline underline-offset-4"
            onClick={() => { setSentTo(null); setError(null); }}
          >Change email or request a new link</button>
        </div>
      ) : (
        <form onSubmit={sendLink}>
          <label htmlFor="email" className="block text-sm font-medium">Invited email address</label>
          <input
            id="email" type="email" autoComplete="email" value={email}
            onChange={(event) => setEmail(event.target.value)} required disabled={busy} className={inputClass}
          />
          <button type="submit" disabled={busy || !email.trim()} className={buttonClass}>
            {busy ? "Please wait..." : "Email me a sign-in link"}
          </button>
        </form>
      )}
      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
      <p className="mt-6 text-xs leading-5 text-ink-muted">
        No Hevy password is requested. After signing in, connect your own Hevy Pro API key to start coaching.
      </p>
    </>
  );
}
