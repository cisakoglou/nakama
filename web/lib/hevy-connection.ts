import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { connectionSchema } from "@/lib/hevy-types";
import type { Database } from "@/lib/supabase/database";

export class HevyConnectionError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

function encryptionKey() {
  const encoded = process.env.HEVY_CREDENTIAL_ENCRYPTION_KEY;
  if (!encoded) throw new HevyConnectionError(503, "Hevy connection storage is not configured.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw new HevyConnectionError(503, "Hevy connection encryption is not configured correctly.");
  }
  return key;
}

export function encryptHevyKey(userId: string, apiKey: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(userId));
  const encrypted = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
}

export function decryptHevyKey(userId: string, value: string) {
  const key = encryptionKey();
  const [version, iv, tag, encrypted, extra] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted || extra) {
    throw new HevyConnectionError(503, "Your saved Hevy connection is unreadable. Please reconnect.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    decipher.setAAD(Buffer.from(userId));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]).toString("utf8");
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error("Hevy credential authentication failed", { userId });
    throw new HevyConnectionError(503, "Your saved Hevy connection is unreadable. Please reconnect.");
  }
}

function storage() {
  const { url } = getSupabaseConfig();
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret?.startsWith("sb_secret_")) {
    throw new HevyConnectionError(503, "Private Hevy connection storage is not configured.");
  }
  return createClient<Database>(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function storageFailure(code: string) {
  console.error("Hevy connection database operation failed", { code });
  return new HevyConnectionError(503, "Your Hevy connection could not be accessed. Please try again.");
}

export async function validateHevyKey(apiKey: string) {
  let response: Response;
  try {
    response = await fetch("https://api.hevyapp.com/v1/user/info", {
      headers: { "api-key": apiKey }, cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (!(error instanceof TypeError) && !(error instanceof DOMException)) throw error;
    throw new HevyConnectionError(502, "Hevy could not be reached. Please try again.");
  }
  await response.body?.cancel();
  if ([401, 403].includes(response.status)) {
    throw new HevyConnectionError(400, "Hevy did not accept this key. Check your Hevy Pro subscription and developer settings.");
  }
  if (response.status === 429) throw new HevyConnectionError(429, "Hevy is receiving too many requests. Wait before trying again.");
  if (!response.ok) throw new HevyConnectionError(502, "Hevy is temporarily unavailable. Please try again.");
}

export async function saveHevyConnection(userId: string, apiKey: string) {
  const encrypted_key = encryptHevyKey(userId, apiKey);
  const client = storage();
  await validateHevyKey(apiKey);
  const { data, error } = await client.from("hevy_connections").upsert({
    user_id: userId, encrypted_key, revision: randomUUID(), updated_at: new Date().toISOString(),
  }).select("revision, updated_at").single();
  if (error) throw storageFailure(error.code);
  return connectionSchema.parse({ connected: true, revision: data.revision, connected_at: data.updated_at });
}

export async function loadHevyConnection(userId: string) {
  const { data, error } = await storage().from("hevy_connections")
    .select("encrypted_key, revision").eq("user_id", userId).maybeSingle();
  if (error) throw storageFailure(error.code);
  if (!data) throw new HevyConnectionError(409, "Connect your own Hevy account before starting coaching.");
  return { apiKey: decryptHevyKey(userId, data.encrypted_key), revision: data.revision };
}

export async function deleteHevyConnection(userId: string) {
  const { error } = await storage().from("hevy_connections").delete().eq("user_id", userId);
  if (error) throw storageFailure(error.code);
}
