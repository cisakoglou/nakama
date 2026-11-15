import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireBetaUser } from "@/lib/auth";
import { getAppOrigin } from "@/lib/app-origin";
import {
  deletePushSubscription, PushStorageError, pushConfig, pushSubscriptionCount, pushSubscriptionSchema,
  savePushSubscription,
} from "@/lib/push";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4_096;
const unsubscribeSchema = z.object({ endpoint: pushSubscriptionSchema.shape.endpoint });

type Access = Extract<Awaited<ReturnType<typeof requireBetaUser>>, { ok: true }>;

function storageError(access: Access) {
  return access.session.json({ error: "Notification settings could not be accessed. Please try again." }, 503);
}

function unavailable(access: Access) {
  return access.session.json({ error: "Notifications are not available on this Nakama server." }, 503);
}

function sameOrigin(request: NextRequest) {
  return request.headers.get("origin") === getAppOrigin(request);
}

async function readBody<T>(request: NextRequest, schema: z.ZodType<T>): Promise<T | null> {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return null;
  }
}

async function status(access: Access) {
  const config = pushConfig();
  return {
    push: {
      available: Boolean(config), public_key: config?.publicKey ?? null,
      subscriptions: config ? await pushSubscriptionCount(access.user.id) : 0,
    },
  };
}

export async function GET(request: NextRequest) {
  const access = await requireBetaUser(request);
  if (!access.ok) return access.response;
  try {
    return access.session.json(await status(access));
  } catch (error) {
    if (!(error instanceof PushStorageError)) throw error;
    return storageError(access);
  }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "This request must come from Nakama." }, { status: 403 });
  const access = await requireBetaUser(request);
  if (!access.ok) return access.response;
  if (!pushConfig()) return unavailable(access);
  const subscription = await readBody(request, pushSubscriptionSchema);
  if (!subscription) return access.session.json({ error: "This browser sent an invalid notification subscription." }, 400);
  try {
    await savePushSubscription(access.user.id, subscription);
    return access.session.json(await status(access));
  } catch (error) {
    if (!(error instanceof PushStorageError)) throw error;
    return storageError(access);
  }
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "This request must come from Nakama." }, { status: 403 });
  const access = await requireBetaUser(request);
  if (!access.ok) return access.response;
  const body = await readBody(request, unsubscribeSchema);
  if (!body) return access.session.json({ error: "This browser sent an invalid notification subscription." }, 400);
  try {
    await deletePushSubscription(access.user.id, body.endpoint);
    return access.session.json(await status(access));
  } catch (error) {
    if (!(error instanceof PushStorageError)) throw error;
    return storageError(access);
  }
}
