import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { decryptHevyKey, encryptHevyKey, HevyConnectionError, storage } from "@/lib/hevy-connection";
import type { Database } from "@/lib/supabase/database";

export const HEVY_OAUTH_COOKIE = "hevy_oauth_browser";
export const HEVY_OAUTH_PATH = "/api/hevy/oauth";
export const HEVY_OAUTH_STATE_SECONDS = 600;
const TOKEN_URL = "https://hevy.com/api/token";
const REFRESH_WAIT_MS = 20_000;
const opaqueValue = /^[A-Za-z0-9_-]{43}$/;
const credential = z.string().min(1).max(16_384).regex(/^[^\s\x00-\x1f\x7f]+$/);
const storedTokensSchema = z.object({ access_token: credential, refresh_token: credential });
const tokenSchema = storedTokensSchema.extend({
  token_type: z.string().refine(value => value.toLowerCase() === "bearer"),
  expires_in: z.number().int().positive().max(31_536_000),
});
const authorizationSchema = tokenSchema.extend({ user_id: z.string().uuid(), username: z.string().min(1).max(100) });

type OAuthErrorCode = "configuration_unavailable" | "invalid_state" | "access_denied" | "provider_unavailable"
  | "connection_changed" | "migration_required" | "account_mismatch" | "account_in_use"
  | "reconnect_required" | "missing_scope" | "not_eligible" | "refresh_busy";

export class HevyOAuthError extends HevyConnectionError {
  constructor(public readonly code: OAuthErrorCode, status: number, message: string) { super(status, message); }
}

function configuration() {
  const clientId = process.env.HEVY_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.HEVY_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new HevyOAuthError("configuration_unavailable", 503, "Hevy OAuth is not configured. Please contact the beta owner.");
  }
  return { clientId, clientSecret };
}

export function hevyOAuthCallback(origin: string) {
  const url = new URL(origin);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
    throw new HevyOAuthError("configuration_unavailable", 503, "Hevy OAuth requires a trusted HTTPS app origin.");
  }
  return new URL(`${HEVY_OAUTH_PATH}/callback`, url.origin).href;
}

function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }

function storageFailure(code: string) {
  console.error("Hevy OAuth storage operation failed", { code });
  return new HevyOAuthError("provider_unavailable", 503, "Your Hevy connection could not be saved or accessed. Please try again.");
}

function changed() {
  return new HevyOAuthError("connection_changed", 409, "Your Hevy connection changed. Open settings before trying again.");
}

function reconnect() {
  return new HevyOAuthError("reconnect_required", 409, "Reconnect Hevy in settings before continuing.");
}

function checkOutcome(outcome: string | null): never {
  switch (outcome) {
    case "migration_required":
      throw new HevyOAuthError("migration_required", 409, "Your API-key connection is unchanged. Upgrading existing connections is not available yet.");
    case "not_eligible":
      throw new HevyOAuthError("not_eligible", 403, "An active Nakama invitation is required to connect Hevy.");
    case "account_mismatch":
      throw new HevyOAuthError("account_mismatch", 409, "Approve the same Hevy account already connected to Nakama. Your connection is unchanged.");
    case "account_in_use":
      throw new HevyOAuthError("account_in_use", 409, "This Hevy account is already connected to another Nakama account.");
    case "invalid_tokens":
      throw new HevyOAuthError("provider_unavailable", 502, "Hevy returned an expired connection. Start again.");
    case "invalid_state":
      throw new HevyOAuthError("invalid_state", 400, "This Hevy connection attempt expired or was already used. Start again in the same browser.");
    case "reconnect_required": throw reconnect();
    case "connection_changed": throw changed();
    default: throw storageFailure("unexpected_oauth_outcome");
  }
}

export async function beginHevyOAuth(userId: string, origin: string) {
  const { clientId } = configuration();
  const redirectUri = hevyOAuthCallback(origin);
  const state = randomBytes(32).toString("base64url");
  const browser = randomBytes(32).toString("base64url");
  const { data, error } = await storage().rpc("begin_hevy_oauth", {
    p_user_id: userId, p_state_hash: hash(state), p_browser_hash: hash(browser),
  });
  if (error) throw storageFailure(error.code);
  if (data !== "started") checkOutcome(data);
  const url = new URL("https://hevy.com/oauth/authorize");
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state }).toString();
  return { authorizationUrl: url.href, browser };
}

class TokenRequestError extends Error {
  constructor(public readonly retryable: boolean, public readonly status: number) { super("Hevy token request failed"); }
}

async function requestTokens(parameters: Record<string, string>) {
  const { clientId, clientSecret } = configuration();
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ ...parameters, client_id: clientId, client_secret: clientSecret }),
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (!(error instanceof TypeError) && !(error instanceof DOMException)) throw error;
    throw new TokenRequestError(false, 502);
  }
  if (!response.ok) {
    if (response.status === 429) {
      await response.body?.cancel();
      throw new TokenRequestError(true, response.status);
    }
    let detail: unknown;
    try { detail = await response.json(); }
    catch (error) {
      if (!(error instanceof SyntaxError) && !(error instanceof TypeError) && !(error instanceof DOMException)) throw error;
      throw new TokenRequestError(false, response.status);
    }
    const parsed = z.object({ error: z.string() }).safeParse(detail);
    // Only an explicit unprocessed request is safe to retry; 401 can also mean invalid_grant.
    const unprocessed = response.status < 500 && parsed.success
      && ["invalid_client", "unauthorized_client", "invalid_request"].includes(parsed.data.error);
    throw new TokenRequestError(unprocessed, response.status);
  }
  try { return await response.json() as unknown; }
  catch (error) {
    if (!(error instanceof SyntaxError) && !(error instanceof TypeError) && !(error instanceof DOMException)) throw error;
    throw new TokenRequestError(false, 502);
  }
}

export async function completeHevyOAuth(
  userId: string, input: { state: string | null; browser: string | undefined; code: string | null; error: string | null },
) {
  if (!input.state || !opaqueValue.test(input.state) || !input.browser || !opaqueValue.test(input.browser)) {
    checkOutcome("invalid_state");
  }
  const stateHash = hash(input.state);
  const db = storage();
  const consumed = await db.rpc("consume_hevy_oauth_state", {
    p_user_id: userId, p_state_hash: stateHash, p_browser_hash: hash(input.browser),
  });
  if (consumed.error) throw storageFailure(consumed.error.code);
  if (!consumed.data) checkOutcome("invalid_state");
  if (input.error) {
    throw new HevyOAuthError("access_denied", 400, "Hevy authorization was not completed. Your existing connection is unchanged.");
  }
  if (!input.code || input.code.length > 2048 || /[\s\x00-\x1f\x7f]/.test(input.code)) {
    throw new HevyOAuthError("invalid_state", 400, "Hevy did not return a valid authorization code. Start again.");
  }
  let raw: unknown;
  try { raw = await requestTokens({ grant_type: "authorization_code", code: input.code }); }
  catch (error) {
    if (!(error instanceof TokenRequestError)) throw error;
    console.warn("Hevy OAuth exchange failed", { status: error.status });
    throw new HevyOAuthError("provider_unavailable", 502, "Hevy could not complete the connection. Start again; your existing connection is unchanged.");
  }
  const parsed = authorizationSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn("Hevy OAuth exchange returned invalid tokens");
    throw new HevyOAuthError("provider_unavailable", 502, "Hevy returned an incomplete connection. Start again.");
  }
  const tokens = parsed.data;
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  let check: Response;
  try {
    check = await fetch("https://api.hevyapp.com/v1/workouts?page=1&pageSize=1", {
      headers: { Authorization: `Bearer ${tokens.access_token}`, accept: "application/json" },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (!(error instanceof TypeError) && !(error instanceof DOMException)) throw error;
    throw new HevyOAuthError("provider_unavailable", 502, "Hevy could not verify the connection. Start again.");
  }
  await check.body?.cancel();
  if (check.status === 403) throw new HevyOAuthError("missing_scope", 403, "Hevy did not grant workout access. Check the app permissions before reconnecting.");
  if (!check.ok) throw new HevyOAuthError("provider_unavailable", 502, "Hevy could not verify workout access. Start again.");
  const { data, error } = await db.rpc("complete_hevy_oauth", {
    p_user_id: userId, p_state_hash: stateHash, p_hevy_user_id: tokens.user_id, p_username: tokens.username,
    p_encrypted_oauth: encryptHevyKey(userId, JSON.stringify(storedTokensSchema.parse(tokens))),
    p_expires_at: expiresAt,
  });
  if (error) throw storageFailure(error.code);
  if (data !== "saved") checkOutcome(data);
}

export type HevyCredentials =
  | { method: "api_key"; apiKey: string; revision: string }
  | { method: "oauth"; accessToken: string; revision: string; hevyUserId: string; tokenVersion: number };

export async function loadHevyCredentials(userId: string): Promise<HevyCredentials> {
  const db = storage();
  const deadline = Date.now() + REFRESH_WAIT_MS;
  for (;;) {
    const { data: connection, error } = await db.from("hevy_connections").select("*").eq("user_id", userId).maybeSingle();
    if (error) throw storageFailure(error.code);
    if (!connection) throw new HevyConnectionError(409, "Connect your own Hevy account before continuing.");
    if (connection.credential_method === "api_key" && connection.encrypted_key) {
      return { method: "api_key", apiKey: decryptHevyKey(userId, connection.encrypted_key), revision: connection.revision };
    }
    if (connection.credential_method !== "oauth" || !connection.encrypted_oauth || !connection.hevy_user_id || !connection.access_expires_at) {
      throw storageFailure("invalid_credential_shape");
    }
    if (connection.oauth_status !== "active") throw reconnect();
    let decrypted: unknown;
    try { decrypted = JSON.parse(decryptHevyKey(userId, connection.encrypted_oauth)); }
    catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw storageFailure("invalid_token_encoding");
    }
    const tokens = storedTokensSchema.safeParse(decrypted);
    if (!tokens.success) throw storageFailure("invalid_token_shape");
    const credentials: HevyCredentials = {
      method: "oauth", accessToken: tokens.data.access_token, revision: connection.revision,
      hevyUserId: connection.hevy_user_id, tokenVersion: connection.token_version,
    };
    if (Date.parse(connection.access_expires_at) > Date.now() + 60_000) return credentials;
    configuration();
    const attempt: Database["public"]["Functions"]["claim_hevy_oauth_refresh"]["Args"] = {
      p_user_id: userId, p_revision: connection.revision,
      p_token_version: connection.token_version, p_attempt_id: randomUUID(),
    };
    const claimed = await db.rpc("claim_hevy_oauth_refresh", attempt);
    if (claimed.error) throw storageFailure(claimed.error.code);
    if (claimed.data === "busy" || claimed.data === "updated") {
      if (Date.now() >= deadline) throw new HevyOAuthError("refresh_busy", 503, "Your Hevy connection is refreshing. Please try again shortly.");
      await new Promise(resolve => setTimeout(resolve, 50));
      continue;
    }
    if (claimed.data !== "claimed") checkOutcome(claimed.data);
    let refreshed: z.infer<typeof tokenSchema>;
    try {
      const parsed = tokenSchema.safeParse(await requestTokens({ grant_type: "refresh_token", refresh_token: tokens.data.refresh_token }));
      if (!parsed.success || parsed.data.refresh_token === tokens.data.refresh_token) throw new TokenRequestError(false, 502);
      refreshed = parsed.data;
    } catch (error) {
      if (!(error instanceof TokenRequestError)) throw error;
      const failed = await db.rpc("fail_hevy_oauth_refresh", { ...attempt, p_retryable: error.retryable });
      if (failed.error) throw storageFailure(failed.error.code);
      if (!failed.data) throw changed();
      console.warn("Hevy OAuth refresh failed", { status: error.status, reconnectRequired: !error.retryable });
      if (!error.retryable) throw reconnect();
      throw new HevyOAuthError("provider_unavailable", error.status === 429 ? 429 : 503, "Hevy could not refresh the connection. Please try again later.");
    }
    const saved = await db.rpc("finish_hevy_oauth_refresh", {
      ...attempt, p_encrypted_oauth: encryptHevyKey(userId, JSON.stringify(storedTokensSchema.parse(refreshed))),
      p_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
    });
    if (saved.error) throw storageFailure(saved.error.code);
    if (!saved.data) throw changed();
    return { ...credentials, accessToken: refreshed.access_token, tokenVersion: connection.token_version + 1 };
  }
}
