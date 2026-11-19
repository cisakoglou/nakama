import "server-only";
import { setTimeout as delay } from "node:timers/promises";
import { HevyConnectionError, storage } from "@/lib/hevy-connection";
import { loadHevyCredentials } from "@/lib/hevy-oauth";
import { waitForHevyRequest } from "@/lib/hevy-rate-limit";

type Method = "GET" | "POST" | "PUT";
type RequestOptions = {
  method?: Method;
  query?: Record<string, string | number>;
  body?: unknown;
};

export class HevyConnectionChangedError extends HevyConnectionError {
  constructor() { super(409, "Your Hevy connection changed. Reopen settings before continuing."); }
}

export class HevyRequestError extends HevyConnectionError {
  constructor(public readonly providerStatus: number | null, method: Method = "GET") {
    const message = providerStatus === 401 ? "Hevy rejected your connection. Reconnect Hevy before continuing."
      : providerStatus === 403 ? "Hevy denied this operation. Check the app permissions and any Hevy account limits."
      : providerStatus === 429 ? "Hevy's request limit was reached. Please try again later."
      : providerStatus === 404 ? "This Hevy record was not found."
      : providerStatus === 400 ? "Hevy rejected the operation's inputs."
      : providerStatus === 200 ? "Hevy returned an incomplete or unreadable response."
      : "Hevy is temporarily unavailable. Please try again.";
    super(providerStatus === 401 ? 409 : providerStatus !== null && [400, 403, 404, 429].includes(providerStatus) ? providerStatus : 502,
      method === "GET" ? message : `${message} Check Hevy before approving this action again; its outcome may be uncertain.`);
  }
}

export type HevyClient = Awaited<ReturnType<typeof createHevyClient>>;

export async function createHevyClient(userId: string, signal = new AbortController().signal) {
  signal.throwIfAborted();
  const { revision } = await loadHevyCredentials(userId);
  return {
    revision,
    async request(path: string, { method = "GET", query = {}, body }: RequestOptions = {}): Promise<unknown> {
      if (!/^\/(?:workouts(?:\/[A-Za-z0-9_-]+)?|routines(?:\/[A-Za-z0-9_-]+)?|exercise_templates(?:\/[A-Za-z0-9_-]+)?|exercise_history\/[A-Za-z0-9_-]+)$/.test(path)) {
        throw new HevyConnectionError(400, "Invalid Hevy resource.");
      }
      const url = new URL(`https://api.hevyapp.com/v1${path}`);
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
      for (let attempt = 0; ; attempt++) {
        await waitForHevyRequest(signal);
        const credentials = await loadHevyCredentials(userId);
        signal.throwIfAborted();
        if (credentials.revision !== revision) throw new HevyConnectionChangedError();
        const headers: Record<string, string> = { accept: "application/json" };
        if (credentials.method === "api_key") headers["api-key"] = credentials.apiKey;
        else headers.Authorization = `Bearer ${credentials.accessToken}`;
        if (body !== undefined) headers["Content-Type"] = "application/json";
        const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
        let response: Response;
        try {
          response = await fetch(url, {
            method, headers, body: body === undefined ? undefined : JSON.stringify(body),
            cache: "no-store", redirect: "error", signal: requestSignal,
          });
        } catch (error) {
          signal.throwIfAborted();
          if (!(error instanceof TypeError) && !(error instanceof DOMException)) throw error;
          throw new HevyRequestError(null, method);
        }
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 401 && credentials.method === "oauth") {
            const rejected = await storage().rpc("reject_hevy_oauth_token", {
              p_user_id: userId, p_revision: revision, p_token_version: credentials.tokenVersion,
            });
            if (rejected.error) {
              console.error("Hevy rejected-token state could not be saved", { code: rejected.error.code });
              throw new HevyConnectionError(503, "Your Hevy connection could not be updated. Check Hevy before repeating any write.");
            }
          }
          if (response.status === 429 && method === "GET" && attempt < 2) {
            await delay(1_000 * 2 ** attempt, undefined, { signal });
            continue;
          }
          throw new HevyRequestError(response.status, method);
        }
        try { return await response.json() as unknown; }
        catch (error) {
          signal.throwIfAborted();
          if (!(error instanceof SyntaxError) && !(error instanceof TypeError) && !(error instanceof DOMException)) throw error;
          throw new HevyRequestError(200, method);
        }
      }
    },
  };
}
