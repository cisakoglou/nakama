// Nakama service worker: workout report notifications only (no offline caching).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const conversationId = typeof data.conversationId === "string" && UUID.test(data.conversationId) ? data.conversationId : null;
  const title = typeof data.title === "string" ? data.title.slice(0, 80) : "";
  event.waitUntil(self.registration.showNotification("Your workout report is ready", {
    body: title || "Open Nakama to read it.",
    icon: "/icon.png",
    badge: "/icon.png",
    tag: conversationId ? `workout-report-${conversationId}` : "workout-report",
    data: { conversationId },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const conversationId = event.notification.data && event.notification.data.conversationId;
  const target = conversationId ? `/?chat=${conversationId}` : "/";
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const app = windows.find((client) => new URL(client.url).pathname === "/");
    if (app) {
      await app.focus();
      if (conversationId) app.postMessage({ type: "nakama:open-chat", conversationId });
      return;
    }
    await self.clients.openWindow(target);
  })());
});
