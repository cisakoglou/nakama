import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireBetaUser } from "@/lib/auth";
import { getAppOrigin } from "@/lib/app-origin";
import { ConversationError, conversationStore } from "@/lib/conversations";

export async function GET(request: NextRequest) {
  const access = await requireBetaUser(request);
  if (!access.ok) return access.response;
  const page = z.coerce.number().int().min(0).max(10000).safeParse(request.nextUrl.searchParams.get("page") ?? 0);
  if (!page.success) return access.session.json({ error: "Choose a valid chat history page." }, 400);
  try {
    return access.session.json(await conversationStore(access.session.client, access.user.id).list(page.data));
  } catch (error) {
    if (!(error instanceof ConversationError)) throw error;
    return access.session.json({ error: error.message }, error.status);
  }
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== getAppOrigin(request)) {
    return NextResponse.json({ error: "This request must come from Nakama." }, { status: 403 });
  }
  const access = await requireBetaUser(request);
  if (!access.ok) return access.response;
  try {
    return access.session.json({
      conversation: await conversationStore(access.session.client, access.user.id).create(),
    }, 201);
  } catch (error) {
    if (!(error instanceof ConversationError)) throw error;
    return access.session.json({ error: error.message }, error.status);
  }
}
