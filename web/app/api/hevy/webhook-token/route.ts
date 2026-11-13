import { NextRequest, NextResponse } from "next/server";
import { requireBetaUser } from "@/lib/auth";
import { getAppOrigin } from "@/lib/app-origin";
import {
  createWebhookToken, revokeWebhookToken, webhookTokenStatus, WebhookStorageError,
} from "@/lib/hevy-webhook";

export const dynamic = "force-dynamic";

function webhookUrl(request: NextRequest) {
  return `${getAppOrigin(request)}/api/hevy/webhook`;
}

function storageError(access: Extract<Awaited<ReturnType<typeof requireBetaUser>>, { ok: true }>) {
  return access.session.json({ error: "Workout report settings could not be accessed. Please try again." }, 503);
}

function sameOrigin(request: NextRequest) {
  return request.headers.get("origin") === getAppOrigin(request);
}

export async function GET(request: NextRequest) {
  const access = await requireBetaUser(request);
  if (!access.ok) return access.response;
  try {
    const status = await webhookTokenStatus(access.user.id);
    return access.session.json({ webhook: { ...status, url: webhookUrl(request) } });
  } catch (error) {
    if (!(error instanceof WebhookStorageError)) throw error;
    return storageError(access);
  }
}

export async function PUT(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "This request must come from Nakama." }, { status: 403 });
  const access = await requireBetaUser(request);
  if (!access.ok) return access.response;
  try {
    const token = await createWebhookToken(access.user.id);
    if (!token) return access.session.json({ error: "Connect Hevy before setting up workout reports." }, 409);
    return access.session.json({
      webhook: { configured: true, url: webhookUrl(request), authorization: `Bearer ${token}` },
    });
  } catch (error) {
    if (!(error instanceof WebhookStorageError)) throw error;
    return storageError(access);
  }
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "This request must come from Nakama." }, { status: 403 });
  const access = await requireBetaUser(request);
  if (!access.ok) return access.response;
  try {
    await revokeWebhookToken(access.user.id);
    return access.session.json({ webhook: { configured: false, url: webhookUrl(request) } });
  } catch (error) {
    if (!(error instanceof WebhookStorageError)) throw error;
    return storageError(access);
  }
}
