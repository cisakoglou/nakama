export type PushSupport = "supported" | "unsupported" | "ios-install";

export type PushEnvironment = {
  serviceWorker: boolean; pushManager: boolean; notification: boolean;
  userAgent: string; platform: string; maxTouchPoints: number; standalone: boolean;
};

export function isIos(env: Pick<PushEnvironment, "userAgent" | "platform" | "maxTouchPoints">) {
  // iPadOS reports itself as a Mac; touch support tells them apart.
  return /iPad|iPhone|iPod/.test(env.userAgent) || (env.platform === "MacIntel" && env.maxTouchPoints > 1);
}

// iOS only offers Web Push to a web app added to the Home Screen.
export function pushSupport(env: PushEnvironment): PushSupport {
  if (isIos(env) && !env.standalone) return "ios-install";
  return env.serviceWorker && env.pushManager && env.notification ? "supported" : "unsupported";
}

export function browserPushEnvironment(): PushEnvironment {
  return {
    serviceWorker: "serviceWorker" in navigator, pushManager: "PushManager" in window, notification: "Notification" in window,
    userAgent: navigator.userAgent, platform: navigator.platform ?? "", maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone: window.matchMedia?.("(display-mode: standalone)").matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true,
  };
}

export function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

// A subscription made with an older VAPID key cannot receive messages signed with the current one.
export function sameServerKey(current: ArrayBuffer | null | undefined, publicKey: string) {
  if (!current) return false;
  const a = new Uint8Array(current);
  const b = base64UrlToBytes(publicKey);
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

type DeviceSubscription = { endpoint: string; unsubscribe(): Promise<boolean> };
export type ReleaseDeps = {
  subscription: () => Promise<DeviceSubscription | null>;
  fetch: typeof fetch;
  timeoutMs?: number;
};

export const RELEASE_TIMEOUT_MS = 2_000;

// Best effort before sign-out, so a shared device stops getting the previous user's report notifications.
// Never throws and resolves within the timeout. Unsubscribing locally even when the DELETE fails is enough:
// the push service then answers 404/410 and the server drops the row on the next send.
export async function releasePushSubscription(deps: ReleaseDeps): Promise<void> {
  const timeoutMs = deps.timeoutMs ?? RELEASE_TIMEOUT_MS;
  const work = (async () => {
    const subscription = await deps.subscription().catch(() => null);
    if (!subscription) return;
    try {
      await deps.fetch("/api/push", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }), signal: AbortSignal.timeout(timeoutMs),
      });
    } catch { /* the server copy is cleaned up when the push service reports it gone */ }
    try { await subscription.unsubscribe(); } catch { /* nothing more to do */ }
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([work, new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); })]);
  clearTimeout(timer);
}

// This browser's current push subscription, if a service worker was ever registered.
export async function browserPushSubscription(): Promise<DeviceSubscription | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager?.getSubscription()) ?? null;
}
