"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { SignInForm } from "@/components/sign-in-form";
import { ProfileForm } from "@/components/profile-form";
import { HevyConnectionForm } from "@/components/hevy-connection-form";
import { ChatPanel } from "@/components/chat-panel";
import { readApiResponse } from "@/lib/api-response";
import {
  accountSchema, EQUIPMENT_LABELS, EXPERIENCE_LABELS, GOAL_LABELS, type Account,
} from "@/lib/profile";
import { createClient } from "@/lib/supabase/client";

type Screen =
  | { kind: "loading" }
  | { kind: "sign-in"; message?: string }
  | { kind: "denied"; message: string }
  | { kind: "error"; message: string }
  | { kind: "account"; account: Account; editing: boolean };

export default function Home() {
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [reload, setReload] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  function reloadAccount() {
    setScreen({ kind: "loading" });
    setActionError(null);
    setShowSettings(false);
    setReload((value) => value + 1);
  }

  useEffect(() => {
    const controller = new AbortController();
    async function loadAccount() {
      try {
        const response = await fetch("/api/account", {
          cache: "no-store", signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          const authError = new URLSearchParams(window.location.search).get("auth_error");
          const message = authError === "link_expired"
            ? "This sign-in link has expired or has already been used. Please request a new link."
            : authError === "sign_in_failed"
              ? "Sign-in failed. Try Google again, or request a new email link and open it in the same browser."
              : undefined;
          if (authError) window.history.replaceState(null, "", "/");
          setScreen({
            kind: "sign-in",
            message,
          });
          return;
        }
        if (response.status === 403) {
          setScreen({ kind: "denied", message: "Nakama is invite-only. Sign out and use your invited email address." });
          return;
        }
        const account = await readApiResponse(response, accountSchema);
        if (!controller.signal.aborted) setScreen({ kind: "account", account, editing: false });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (!(error instanceof Error)) throw error;
        setScreen({ kind: "error", message: error.message });
      }
    }
    void loadAccount();
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    if (screen.kind === "loading" || screen.kind === "error") return;
    const { data } = createClient().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") setScreen({ kind: "sign-in" });
      if (event === "SIGNED_IN") reloadAccount();
    });
    return () => data.subscription.unsubscribe();
  }, [screen.kind]);

  async function signOut() {
    setSigningOut(true);
    setActionError(null);
    try {
      const { error } = await createClient().auth.signOut();
      if (error) throw error;
      setScreen({ kind: "sign-in" });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setActionError(error.message);
    } finally {
      setSigningOut(false);
    }
  }

  if (screen.kind === "account" && screen.account.profile && screen.account.connection.connected && !screen.editing && !showSettings) {
    return <ChatPanel
      key={`${screen.account.user.id}:${screen.account.connection.revision}:${screen.account.profile.updated_at}`}
      onSettings={() => setShowSettings(true)} onSignOut={() => { void signOut(); }}
      signingOut={signingOut} accountError={actionError}
    />;
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="w-full max-w-lg">
        <Image
          src="/brand/nakama-wordmark.webp" alt="Nakama" width={900} height={180}
          sizes="288px" priority className="mx-auto mb-9 h-auto w-72 max-w-full"
        />
        <section className="rounded-3xl border border-line bg-surface p-6 shadow-[0_20px_60px_-25px_rgba(52,52,45,0.22)] sm:p-8">
          {screen.kind === "loading" && <p role="status">Loading your training space...</p>}
          {screen.kind === "sign-in" && <SignInForm message={screen.message} onRefresh={reloadAccount} />}
          {screen.kind === "error" && (
            <>
              <h1 className="text-2xl font-semibold">Unable to open Nakama</h1>
              <p role="alert" className="mt-3 text-sm text-red-700">{screen.message}</p>
              <button onClick={reloadAccount} className="mt-5 rounded-xl bg-brand px-4 py-3 font-semibold">Try again</button>
            </>
          )}
          {screen.kind === "denied" && (
            <>
              <h1 className="text-2xl font-semibold">An invitation is required</h1>
              <p role="alert" className="mt-3 text-sm leading-6 text-ink-muted">{screen.message}</p>
            </>
          )}
          {screen.kind === "account" && (
            <>
              <p className="break-all text-sm text-ink-muted">{screen.account.user.email}</p>
              {screen.editing || !screen.account.profile ? (
                <ProfileForm
                  profile={screen.account.profile}
                  onSaved={reloadAccount}
                  onCancel={screen.account.profile ? () => setScreen({ ...screen, editing: false }) : undefined}
                />
              ) : (
                <>
                  <h1 className="mt-3 text-3xl font-semibold tracking-tight">Your training space</h1>
                  <p className="mt-3 text-sm leading-6 text-ink-muted">Your preferences are saved to your account.</p>
                  <dl className="mt-5 space-y-3 rounded-2xl border border-line bg-canvas p-5 text-sm">
                    <div><dt className="text-ink-muted">Goal</dt><dd>{GOAL_LABELS[screen.account.profile.goal]}</dd></div>
                    <div><dt className="text-ink-muted">Experience</dt><dd>{EXPERIENCE_LABELS[screen.account.profile.experience]}</dd></div>
                    <div><dt className="text-ink-muted">Schedule</dt><dd>{screen.account.profile.training_days} days per week</dd></div>
                    <div><dt className="text-ink-muted">Equipment</dt><dd>{EQUIPMENT_LABELS[screen.account.profile.equipment]}</dd></div>
                    <div><dt className="text-ink-muted">Weight units</dt><dd>{screen.account.profile.units}</dd></div>
                  </dl>
                  <button
                    onClick={() => setScreen({ ...screen, editing: true })}
                    className="mt-5 rounded-xl bg-brand px-4 py-3 text-sm font-semibold hover:bg-brand-hover"
                  >Edit preferences</button>
                  {screen.account.connection.connected && <button
                    onClick={() => setShowSettings(false)}
                    className="ml-4 mt-5 min-h-11 text-sm underline underline-offset-4"
                  >Back to coaching</button>}
                  <HevyConnectionForm connection={screen.account.connection} onChanged={reloadAccount} />
                </>
              )}
            </>
          )}
          {actionError && <p role="alert" className="mt-4 text-sm text-red-700">{actionError}</p>}
          {(screen.kind === "account" || screen.kind === "denied") && (
            <button
              onClick={signOut} disabled={signingOut}
              className="mt-6 min-h-11 text-sm text-ink-muted underline underline-offset-4 disabled:opacity-50"
            >{signingOut ? "Signing out..." : "Sign out"}</button>
          )}
        </section>
        <p className="mt-6 text-center text-xs text-ink-muted">Invite-only beta. Your workouts. Your next step.</p>
      </div>
    </main>
  );
}
