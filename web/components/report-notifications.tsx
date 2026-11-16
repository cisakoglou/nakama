"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { readApiResponse } from "@/lib/api-response";
import { base64UrlToBytes, browserPushEnvironment, pushSupport, sameServerKey } from "@/lib/push-client";

const statusSchema = z.object({
  push: z.object({ available: z.boolean(), public_key: z.string().nullable(), subscriptions: z.number().int().nonnegative() }),
});

type State = "loading" | "unsupported" | "ios-install" | "unavailable" | "denied" | "on" | "off";

async function currentSubscription() {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

async function send(method: "POST" | "DELETE", body: unknown) {
  return readApiResponse(await fetch("/api/push", {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }), statusSchema);
}

export function ReportNotifications() {
  const [state, setState] = useState<State>("loading");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const support = pushSupport(browserPushEnvironment());
    if (support !== "supported") return setState(support);
    try {
      const { push } = await readApiResponse(await fetch("/api/push", { cache: "no-store" }), statusSchema);
      if (!push.available || !push.public_key) return setState("unavailable");
      setPublicKey(push.public_key);
      if (Notification.permission === "denied") return setState("denied");
      const subscription = Notification.permission === "granted" ? await currentSubscription() : null;
      if (subscription && sameServerKey(subscription.options.applicationServerKey, push.public_key)) {
        // The server may have dropped this device (failures, the 10-device cap) even if others remain;
        // saving again is an idempotent upsert keyed by endpoint.
        await send("POST", subscription.toJSON());
        return setState("on");
      }
      setState("off");
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setError(error.message);
      setState("off");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function enable() {
    if (!publicKey) return;
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (subscription && !sameServerKey(subscription.options.applicationServerKey, publicKey)) {
        await subscription.unsubscribe();
        subscription = null;
      }
      subscription ??= await registration.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey),
      });
      await send("POST", subscription.toJSON());
      setState("on");
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setError(error.message || "Notifications could not be turned on in this browser.");
    } finally { setBusy(false); }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      const subscription = await currentSubscription();
      if (subscription) {
        await send("DELETE", { endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      setState("off");
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setError(error.message);
    } finally { setBusy(false); }
  }

  const message: Partial<Record<State, string>> = {
    unsupported: "This browser does not support notifications. Reports still appear in your chats.",
    "ios-install": "On iPhone, add Nakama to your Home Screen first (Share, then Add to Home Screen), then open it from there to turn on notifications.",
    unavailable: "Notifications are not available on this Nakama server yet. Reports still appear in your chats.",
    denied: "Notifications are blocked for Nakama. Allow them in your browser or system settings, then reload this page.",
  };

  return (
    <section aria-labelledby="report-notifications-heading" className="mt-6 rounded-2xl border border-line p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="report-notifications-heading" className="text-lg font-semibold">Notify me when a report is ready</h2>
        {(state === "on" || state === "off") && (
          <span className="rounded-full bg-brand-soft px-3 py-1 text-xs font-medium text-brand">
            {state === "on" ? "On for this device" : "Off"}
          </span>
        )}
      </div>
      <p className="mt-3 text-sm leading-6 text-ink-muted">
        Get a notification on this device when a new post-workout report is added to your chats.
      </p>
      {message[state] && <p className="mt-3 rounded-xl border border-line bg-canvas p-4 text-sm leading-6">{message[state]}</p>}
      {state === "off" && (
        <button type="button" onClick={() => { void enable(); }} disabled={busy}
          className="mt-4 w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold hover:bg-brand-hover disabled:opacity-50"
        >{busy ? "Please wait..." : "Turn on notifications"}</button>
      )}
      {state === "on" && (
        <button type="button" onClick={() => { void disable(); }} disabled={busy}
          className="mt-3 min-h-11 text-sm underline underline-offset-4 disabled:opacity-50"
        >{busy ? "Please wait..." : "Turn off notifications on this device"}</button>
      )}
      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
    </section>
  );
}
