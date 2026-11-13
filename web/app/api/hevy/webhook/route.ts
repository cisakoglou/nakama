import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  enqueueWorkoutReport, parseWebhookAuthorization, resolveWebhookOwner, WEBHOOK_STORAGE_DEADLINE_MS,
  WebhookStorageError,
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

export async function POST(request: NextRequest) {
  const token = parseWebhookAuthorization(request.headers.get("authorization"));
  if (!token) return reply({ error: "Not authorized." }, 401);
  const signal = AbortSignal.timeout(WEBHOOK_STORAGE_DEADLINE_MS);
  try {
    const owner = await resolveWebhookOwner(token, signal);
    if (!owner) return reply({ error: "Not authorized." }, 401);

    const text = await readBoundedBody(request, signal);
    let body: unknown;
    try { body = JSON.parse(text); }
    catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      return reply({ error: "Send a JSON workout event." }, 400);
    }
    const payload = payloadSchema.safeParse(body);
    if (!payload.success) return reply({ error: "Send a workoutId." }, 400);

    const { queued } = await enqueueWorkoutReport(owner, payload.data.workoutId, signal);
    if (queued) wakeWorkoutReportWorker();
    return reply({ received: true }, 200);
  } catch (error) {
    if (error instanceof PayloadTooLarge) return reply({ error: "Payload too large." }, 413);
    if (error instanceof WebhookStorageError || signal.aborted) {
      return reply({ error: "Workout event could not be saved. Please retry." }, 503);
    }
    throw error;
  }
}
