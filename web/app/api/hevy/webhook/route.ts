import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  describeAuthorizationShape, diagnoseWebhookRejection, enqueueWorkoutReport, parseWebhookAuthorization,
  resolveWebhookOwner, WEBHOOK_STORAGE_DEADLINE_MS, WebhookStorageError,
} from "@/lib/hevy-webhook";
import { wakeWorkoutReportWorker } from "@/lib/workout-report-worker";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4096;
const payloadSchema = z.object({ workoutId: z.string().uuid() });

class PayloadTooLarge extends Error {}

// Reads at most MAX_BODY_BYTES and stops when the shared acknowledgement deadline expires.
async function readBoundedBody(request: NextRequest, signal: AbortSignal) {
  if (!request.body) return "";
  const reader = request.body.getReader();
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
      if (size > MAX_BODY_BYTES) throw new PayloadTooLarge();
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function reply(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

// Logs never include the token, its hash, or body values: only shapes, keys and reasons.
function logRejection(reason: string, details: Record<string, unknown> = {}) {
  console.warn("Hevy webhook rejected", { reason, ...details });
}

function bodyShape(body: unknown) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { bodyType: Array.isArray(body) ? "array" : typeof body };
  return { bodyKeys: Object.keys(body).slice(0, 20) };
}

export async function POST(request: NextRequest) {
  const header = request.headers.get("authorization");
  const token = parseWebhookAuthorization(header);
  if (!token) {
    logRejection(header === null ? "missing_header" : "malformed_header", {
      header: describeAuthorizationShape(header),
      // Header names only, to spot a token sent under a different header.
      headerNames: [...request.headers.keys()].filter((name) => !name.startsWith("x-railway")).slice(0, 30),
    });
    return reply({ error: "Not authorized." }, 401);
  }
  const signal = AbortSignal.timeout(WEBHOOK_STORAGE_DEADLINE_MS);
  try {
    const owner = await resolveWebhookOwner(token, signal);
    if (!owner) {
      try {
        const { reason, ...details } = await diagnoseWebhookRejection(token, signal);
        logRejection(reason, details);
      } catch {
        logRejection("owner_not_found", { diagnosis: "unavailable" });
      }
      return reply({ error: "Not authorized." }, 401);
    }

    const text = await readBoundedBody(request, signal);
    let body: unknown;
    try { body = JSON.parse(text); }
    catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      logRejection("invalid_json", { userId: owner.userId, contentType: request.headers.get("content-type"), bytes: text.length });
      return reply({ error: "Send a JSON workout event." }, 400);
    }
    const payload = payloadSchema.safeParse(body);
    if (!payload.success) {
      logRejection("invalid_payload", { userId: owner.userId, ...bodyShape(body) });
      return reply({ error: "Send a workoutId." }, 400);
    }

    const { queued } = await enqueueWorkoutReport(owner, payload.data.workoutId, signal);
    if (queued) wakeWorkoutReportWorker();
    console.info("Hevy webhook accepted", { userId: owner.userId, queued });
    return reply({ received: true }, 200);
  } catch (error) {
    if (error instanceof PayloadTooLarge) {
      logRejection("payload_too_large");
      return reply({ error: "Payload too large." }, 413);
    }
    if (error instanceof WebhookStorageError || signal.aborted) {
      logRejection("storage_unavailable", { timedOut: signal.aborted });
      return reply({ error: "Workout event could not be saved. Please retry." }, 503);
    }
    throw error;
  }
}
