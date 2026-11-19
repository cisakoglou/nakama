import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { HevyConnectionError, storage } from "@/lib/hevy-connection";
import { WORKOUT_REPORT_FIRST_ATTEMPT_DELAY_MS, WebhookStorageError } from "@/lib/hevy-webhook";

/**
 * Signed Hevy app webhooks (developers.hevy.com, Authentication > App webhooks): one POST per newly saved workout of a
 * connected user, `Hevy-Signature: sha256=<hex HMAC-SHA256 of the raw body keyed with the OAuth client secret>`,
 * body `{ type: "workout.created", workoutId, userId }` where userId is the token response's user_id. Hevy wants a
 * 200 within 5 s and retries anything else up to 5 times.
 */
export const APP_WEBHOOK_MAX_BODY_BYTES = 4096;
export const APP_WEBHOOK_EVENT = "workout.created";

const SIGNATURE_PATTERN = /^sha256=([0-9a-f]{64})$/i;

export class AppWebhookConfigurationError extends Error {}

export function appWebhookSecret() {
  const secret = process.env.HEVY_OAUTH_CLIENT_SECRET?.trim();
  if (!secret) throw new AppWebhookConfigurationError("HEVY_OAUTH_CLIENT_SECRET is not configured.");
  return secret;
}

export type SignatureCheck = "valid" | "missing" | "malformed" | "mismatch";

/** Timing-safe check of the Hevy-Signature header over the exact received bytes. */
export function verifyAppWebhookSignature(rawBody: Uint8Array, header: string | null, secret: string): SignatureCheck {
  if (header === null) return "missing";
  const match = SIGNATURE_PATTERN.exec(header.trim());
  if (!match) return "malformed";
  const received = Buffer.from(match[1], "hex");
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return received.length === expected.length && timingSafeEqual(received, expected) ? "valid" : "mismatch";
}

/** Shape of a rejected signature header for logs, without any of its value. */
export function describeSignatureShape(header: string | null) {
  if (header === null) return { present: false };
  const value = header.trim();
  return { present: true, length: value.length, hasPrefix: value.toLowerCase().startsWith("sha256=") };
}

// Extra provider fields are tolerated; the three we use must be exact.
export const appWebhookPayloadSchema = z.object({
  type: z.string().min(1).max(100),
  workoutId: z.string().uuid(),
  userId: z.string().uuid(),
});

export type AppWebhookResult = "queued" | "duplicate" | "unknown_user" | "not_eligible" | "reconnect_required" | "reports_off";
const acceptResultSchema = z.object({
  result: z.enum(["queued", "duplicate", "unknown_user", "not_eligible", "reconnect_required", "reports_off"]),
  user_id: z.string().uuid().nullable(),
});

function storageFailure(code: string) {
  console.error("Hevy app webhook database operation failed", { code });
  return new WebhookStorageError("Hevy app webhook storage is unavailable.");
}

/**
 * Resolves the verified Hevy user to its OAuth connection, records the receipt and, when that user is eligible and has
 * reports on, durably queues the workout (deduplicated with the personal webhook by user + workout) in one transaction.
 */
export async function acceptAppWebhook(hevyUserId: string, workoutId: string, signal: AbortSignal) {
  let db: ReturnType<typeof storage>;
  try {
    db = storage();
  } catch (error) {
    if (!(error instanceof HevyConnectionError)) throw error;
    throw new WebhookStorageError(error.message);
  }
  const { data, error } = await db.rpc("accept_hevy_app_webhook", {
    p_hevy_user_id: hevyUserId, p_workout_id: workoutId,
    p_available_at: new Date(Date.now() + WORKOUT_REPORT_FIRST_ATTEMPT_DELAY_MS).toISOString(),
  }).abortSignal(signal);
  if (error) throw storageFailure(error.code);
  const parsed = acceptResultSchema.safeParse(data?.[0]);
  if (!parsed.success) throw storageFailure("invalid_result");
  return { result: parsed.data.result as AppWebhookResult, userId: parsed.data.user_id };
}

export class AppWebhookPayloadTooLarge extends Error {}

/** Reads at most `limit` bytes, stopping when `signal` aborts. Returns the exact bytes (no decoding). */
export async function readRawBody(body: ReadableStream<Uint8Array> | null, signal: AbortSignal, limit = APP_WEBHOOK_MAX_BODY_BYTES) {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const aborted = new Promise<never>((_, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
  });
  aborted.catch(() => {});
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new AppWebhookPayloadTooLarge();
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  return new Uint8Array(Buffer.concat(chunks));
}
