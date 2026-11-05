import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireBetaUser } from "@/lib/auth";
import { getAppOrigin } from "@/lib/app-origin";
import { conversationPatchSchema } from "@/lib/conversation-types";
import { ConversationError, conversationBody, conversationStore } from "@/lib/conversations";

type Context = { params: Promise<{ id: string }> };

async function handle(request: NextRequest, context: Context, method: "GET" | "PATCH" | "DELETE") {
  if (method !== "GET" && request.headers.get("origin") !== getAppOrigin(request)) {
    return NextResponse.json({ error: "This request must come from Nakama." }, { status: 403 });
  }
  const access = await requireBetaUser(request);
  if (!access.ok) return access.response;
  const id = z.string().uuid().safeParse((await context.params).id);
  if (!id.success) return access.session.json({ error: "Choose a valid chat." }, 400);
  const store = conversationStore(access.session.client, access.user.id);
  try {
    if (method === "GET") return access.session.json({ conversation: await store.load(id.data) });
    if (method === "PATCH") return access.session.json({
      conversation: await store.patch(id.data, await conversationBody(request, conversationPatchSchema)),
    });
    const body = await conversationBody(request, z.object({ revision: z.number().int().nonnegative() }).strict());
    await store.remove(id.data, body.revision);
    return access.session.json({ deleted: true });
  } catch (error) {
    if (!(error instanceof ConversationError)) throw error;
    return access.session.json({ error: error.message }, error.status);
  }
}

export function GET(request: NextRequest, context: Context) { return handle(request, context, "GET"); }
export function PATCH(request: NextRequest, context: Context) { return handle(request, context, "PATCH"); }
export function DELETE(request: NextRequest, context: Context) { return handle(request, context, "DELETE"); }
