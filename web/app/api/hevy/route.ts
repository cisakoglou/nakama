import { NextRequest, NextResponse } from "next/server";
import { requireBetaUser } from "@/lib/auth";
import { hevyKeySchema } from "@/lib/hevy-types";
import { deleteHevyConnection, HevyConnectionError, saveHevyConnection } from "@/lib/hevy-connection";
import { disconnectChats } from "@/lib/chat-lifecycle";
import { getAppOrigin } from "@/lib/app-origin";

export async function PUT(request: NextRequest) {
  if (request.headers.get("origin") !== getAppOrigin(request)) {
    return NextResponse.json({ error: "This request must come from Nakama." }, { status: 403 });
  }
  const access = await requireBetaUser(request);
  if (!access.ok) return access.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return access.session.json({ error: "Enter a valid Hevy API key." }, 400);
  }
  const parsed = hevyKeySchema.safeParse(body);
  if (!parsed.success) return access.session.json({ error: "Enter only your Hevy API key." }, 400);
  try {
    const connection = await saveHevyConnection(access.user.id, parsed.data.api_key);
    disconnectChats(access.user.id);
    return access.session.json({ connection });
  } catch (error) {
    if (!(error instanceof HevyConnectionError)) throw error;
    return access.session.json({ error: error.message }, error.status);
  }
}

export async function DELETE(request: NextRequest) {
  if (request.headers.get("origin") !== getAppOrigin(request)) {
    return NextResponse.json({ error: "This request must come from Nakama." }, { status: 403 });
  }
  const access = await requireBetaUser(request);
  if (!access.ok) return access.response;
  try {
    await deleteHevyConnection(access.user.id);
    disconnectChats(access.user.id);
    return access.session.json({ connection: { connected: false } });
  } catch (error) {
    if (!(error instanceof HevyConnectionError)) throw error;
    return access.session.json({ error: error.message }, error.status);
  }
}
