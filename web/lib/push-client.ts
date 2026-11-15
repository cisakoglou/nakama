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
