import { NextRequest, NextResponse } from "next/server";
import {
  acceptAppWebhook, APP_WEBHOOK_EVENT, AppWebhookConfigurationError, AppWebhookPayloadTooLarge, appWebhookPayloadSchema,
  appWebhookSecret, describeSignatureShape, readRawBody, verifyAppWebhookSignature,
} from "@/lib/hevy-app-webhook";
import { WEBHOOK_STORAGE_DEADLINE_MS, WebhookStorageError } from "@/lib/hevy-webhook";
import { wakeWorkoutReportWorker } from "@/lib/workout-report-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

// Never logs the signature, the secret or body values: only reasons, shapes and sizes. Hevy user ids are shortened.
function logRejection(reason: string, details: Record<string, unknown> = {}) {
  console.warn("Hevy app webhook rejected", { reason, ...details });
}
const shortId = (id: string) => id.slice(0, 8);

function bodyShape(body: unknown) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { bodyType: Array.isArray(body) ? "array" : typeof body };
  return { bodyKeys: Object.keys(body).slice(0, 20) };
}

export async function POST(request: NextRequest) {
  let secret: string;
  try {
    secret = appWebhookSecret();
  } catch (error) {
    if (!(error instanceof AppWebhookConfigurationError)) throw error;
    logRejection("secret_not_configured");
    return reply({ error: "Webhook verification is not configured." }, 503);
  }

  // One deadline for reading, verifying and storing, inside Hevy's 5 s acknowledgement window.
  const signal = AbortSignal.timeout(WEBHOOK_STORAGE_DEADLINE_MS);
  let raw: Uint8Array;
  try {
    raw = await readRawBody(request.body, signal);
  } catch (error) {
    if (error instanceof AppWebhookPayloadTooLarge) {
      logRejection("payload_too_large");
      return reply({ error: "Payload too large." }, 413);
    }
    if (signal.aborted) {
      logRejection("body_timeout");
      return reply({ error: "Request body timed out." }, 408);
    }
    throw error;
  }

  const header = request.headers.get("hevy-signature");
  const signature = verifyAppWebhookSignature(raw, header, secret);
  if (signature !== "valid") {
    logRejection(`${signature}_signature`, { signature: describeSignatureShape(header), bytes: raw.byteLength });
    return reply({ error: "Not authorized." }, 401);
  }

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch (error) {
    if (!(error instanceof SyntaxError) && !(error instanceof TypeError)) throw error;
    logRejection("invalid_json", { contentType: request.headers.get("content-type"), bytes: raw.byteLength });
    return reply({ error: "Send a JSON workout event." }, 400);
  }
  const payload = appWebhookPayloadSchema.safeParse(body);
  if (!payload.success) {
    logRejection("invalid_payload", bodyShape(body));
    return reply({ error: "Send a workout event." }, 400);
  }
  // Authentic but not something we handle: acknowledge so Hevy does not retry it.
  if (payload.data.type !== APP_WEBHOOK_EVENT) {
    logRejection("unsupported_event", { type: payload.data.type.slice(0, 40) });
    return reply({ received: true, ignored: true }, 200);
  }

  try {
    const { result, userId } = await acceptAppWebhook(payload.data.userId, payload.data.workoutId, signal);
    if (result === "queued") wakeWorkoutReportWorker();
    if (result === "queued" || result === "duplicate") {
      console.info("Hevy app webhook accepted", { userId, queued: result === "queued" });
    } else {
      // Signed, but no report is due: no connection for this Hevy user, uninvited, needs reconnect, or reports off.
      logRejection(result, { userId, hevyUser: shortId(payload.data.userId) });
    }
    return reply({ received: true }, 200);
  } catch (error) {
    if (error instanceof WebhookStorageError || signal.aborted) {
      logRejection("storage_unavailable", { timedOut: signal.aborted });
      return reply({ error: "Workout event could not be saved. Please retry." }, 503);
    }
    throw error;
  }
}
