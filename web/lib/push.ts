import "server-only";
import webpush, { WebPushError } from "web-push";
import { z } from "zod";
import { HevyConnectionError, storage } from "@/lib/hevy-connection";

export class PushStorageError extends Error {}

export const MAX_PUSH_FAILURES = 5;
const SEND_TIMEOUT_MS = 5_000;
// Long enough to reach a phone that was briefly offline; a stale "report ready" is not useful later.
const TTL_SECONDS = 24 * 60 * 60;

export type ReportReadyPayload = { conversationId: string; title: string };

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().max(1024).url().refine((value) => value.startsWith("https://"), "Push endpoint must use https."),
  keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(64) }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

const configSchema = z.object({
  publicKey: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
  privateKey: z.string().regex(/^[A-Za-z0-9_-]{40,50}$/),
  subject: z.string().regex(/^(mailto:\S+@\S+|https:\/\/\S+)$/),
});

// Returns null (push disabled) unless all three VAPID variables are set and well-formed.
export function pushConfig() {
  const parsed = configSchema.safeParse({
    publicKey: process.env.VAPID_PUBLIC_KEY?.trim(),
    privateKey: process.env.VAPID_PRIVATE_KEY?.trim(),
    subject: process.env.VAPID_SUBJECT?.trim(),
  });
  return parsed.success ? parsed.data : null;
}

function storageFailure(code: string) {
  console.error("Push subscription database operation failed", { code });
  return new PushStorageError("Notification settings are unavailable.");
}

function serverStorage() {
  try {
    return storage();
  } catch (error) {
    if (!(error instanceof HevyConnectionError)) throw error;
    throw new PushStorageError(error.message);
  }
}

export async function pushSubscriptionCount(userId: string) {
  const { count, error } = await serverStorage().from("push_subscriptions")
    .select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (error) throw storageFailure(error.code);
  return count ?? 0;
}

// An endpoint belongs to one browser profile, so re-subscribing moves it to the signed-in account.
export async function savePushSubscription(userId: string, subscription: PushSubscriptionInput) {
  const { error } = await serverStorage().from("push_subscriptions").upsert({
    user_id: userId, endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth,
    created_at: new Date().toISOString(), failure_count: 0,
  }, { onConflict: "endpoint" });
  if (error) throw storageFailure(error.code);
}

export async function deletePushSubscription(userId: string, endpoint: string) {
  const { error } = await serverStorage().from("push_subscriptions").delete()
    .eq("user_id", userId).eq("endpoint", endpoint);
  if (error) throw storageFailure(error.code);
}

export type PushSummary = { sent: number; removed: number; failed: number };

// Best effort: never throws. Gone subscriptions (404/410) are deleted; other failures are
// counted and the subscription is dropped after MAX_PUSH_FAILURES consecutive failures.
export async function notifyReportReady(userId: string, payload: ReportReadyPayload): Promise<PushSummary | null> {
  const config = pushConfig();
  if (!config) return null;
  const summary: PushSummary = { sent: 0, removed: 0, failed: 0 };
  try {
    const db = serverStorage();
    const { data: rows, error } = await db.from("push_subscriptions")
      .select("id, endpoint, p256dh, auth, failure_count").eq("user_id", userId);
    if (error) throw storageFailure(error.code);
    const body = JSON.stringify({ conversationId: payload.conversationId, title: payload.title });
    await Promise.all((rows ?? []).map(async (row) => {
      let status: number | null = null;
      try {
        await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, body, {
          vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
          TTL: TTL_SECONDS, urgency: "normal", timeout: SEND_TIMEOUT_MS,
          // Push services collapse queued messages with the same topic (max 32 URL-safe chars).
          topic: payload.conversationId.replace(/-/g, "").slice(0, 32),
        });
      } catch (error) {
        status = error instanceof WebPushError ? error.statusCode : 0;
      }
      const table = db.from("push_subscriptions");
      if (status === null) {
        summary.sent++;
        await table.update({ last_success_at: new Date().toISOString(), failure_count: 0 }).eq("id", row.id);
      } else if (status === 404 || status === 410 || row.failure_count + 1 >= MAX_PUSH_FAILURES) {
        summary.removed++;
        await table.delete().eq("id", row.id);
      } else {
        summary.failed++;
        await table.update({ failure_count: row.failure_count + 1 }).eq("id", row.id);
      }
    }));
  } catch (error) {
    console.error("Workout report notification failed", { error: error instanceof Error ? error.message : "unknown" });
  }
  return summary;
}
