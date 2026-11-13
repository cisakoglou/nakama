import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { HevyConnectionError, storage } from "@/lib/hevy-connection";

export class WebhookStorageError extends Error {}

// Hevy expects a 200 within five seconds; storage work must finish well inside that.
export const WEBHOOK_STORAGE_DEADLINE_MS = 3_000;

export type WebhookOwner = { userId: string; revision: string };

const TOKEN_PATTERN = /^nkwh_[A-Za-z0-9_-]{43}$/;

function storageFailure(code: string) {
  console.error("Hevy webhook database operation failed", { code });
  return new WebhookStorageError("Hevy webhook storage is unavailable.");
}

function serverStorage() {
  try {
    return storage();
  } catch (error) {
    if (!(error instanceof HevyConnectionError)) throw error;
    throw new WebhookStorageError(error.message);
  }
}

export function parseWebhookAuthorization(header: string | null) {
  const token = header?.trim().replace(/^Bearer\s+/i, "");
  return token && TOKEN_PATTERN.test(token) ? token : null;
}

export function hashWebhookToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function resolveWebhookOwner(token: string, signal: AbortSignal): Promise<WebhookOwner | null> {
  const { data, error } = await serverStorage()
    .rpc("hevy_webhook_owner", { p_token_hash: hashWebhookToken(token) }).abortSignal(signal);
  if (error) throw storageFailure(error.code);
  const owner = data?.[0];
  return owner ? { userId: owner.user_id, revision: owner.connection_revision } : null;
}

export async function enqueueWorkoutReport(owner: WebhookOwner, workoutId: string, signal: AbortSignal) {
  const { data, error } = await serverStorage().from("workout_reports")
    .upsert(
      { user_id: owner.userId, workout_id: workoutId, connection_revision: owner.revision },
      { onConflict: "user_id,workout_id", ignoreDuplicates: true },
    )
    .select("workout_id").abortSignal(signal);
  if (error) throw storageFailure(error.code);
  return { queued: (data ?? []).length > 0 };
}

export async function webhookTokenStatus(userId: string) {
  const db = serverStorage();
  const [{ data: token, error }, { data: connection, error: connectionError }] = await Promise.all([
    db.from("hevy_webhook_tokens").select("connection_revision, created_at").eq("user_id", userId).maybeSingle(),
    db.from("hevy_connections").select("revision").eq("user_id", userId).maybeSingle(),
  ]);
  if (error || connectionError) throw storageFailure((error ?? connectionError)!.code);
  return {
    configured: Boolean(token && connection && token.connection_revision === connection.revision),
    created_at: token?.created_at ?? null,
  };
}

export async function createWebhookToken(userId: string) {
  const db = serverStorage();
  const { data: connection, error } = await db.from("hevy_connections")
    .select("revision").eq("user_id", userId).maybeSingle();
  if (error) throw storageFailure(error.code);
  if (!connection) return null;
  const token = `nkwh_${randomBytes(32).toString("base64url")}`;
  const { error: saveError } = await db.from("hevy_webhook_tokens").upsert({
    user_id: userId, token_hash: hashWebhookToken(token), connection_revision: connection.revision,
    created_at: new Date().toISOString(),
  });
  if (saveError) throw storageFailure(saveError.code);
  return token;
}

export async function revokeWebhookToken(userId: string) {
  const { error } = await serverStorage().from("hevy_webhook_tokens").delete().eq("user_id", userId);
  if (error) throw storageFailure(error.code);
}
