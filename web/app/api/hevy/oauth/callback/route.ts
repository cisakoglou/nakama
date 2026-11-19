import { NextRequest, NextResponse } from "next/server";
import { requireBetaUser } from "@/lib/auth";
import { getAppOrigin } from "@/lib/app-origin";
import { HevyConnectionError } from "@/lib/hevy-connection";
import { completeHevyOAuth, HEVY_OAUTH_COOKIE, HEVY_OAUTH_PATH, HevyOAuthError } from "@/lib/hevy-oauth";
import { disconnectChats } from "@/lib/chat-lifecycle";

export const runtime = "nodejs";

// REPORTS-CONTRACT.md: the codes the UI explains after a failed callback; anything else is "unknown".
const CALLBACK_ERROR_CODES: ReadonlySet<string> = new Set([
  "access_denied", "invalid_state", "account_in_use", "account_mismatch", "connection_changed", "migration_required",
  "missing_scope", "not_eligible", "provider_unavailable", "configuration_unavailable", "reconnect_required", "refresh_busy",
]);
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const origin = getAppOrigin(request);
  function finish(response: NextResponse) {
    response.cookies.set(HEVY_OAUTH_COOKIE, "", {
      httpOnly: true, secure: new URL(origin).protocol === "https:",
      sameSite: "lax", path: HEVY_OAUTH_PATH, maxAge: 0,
    });
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }
  const access = await requireBetaUser(request);
  if (!access.ok) return finish(access.response);
  try {
    const params = request.nextUrl.searchParams;
    if (["state", "code", "error"].some(key => params.getAll(key).length > 1)) {
      throw new HevyOAuthError("invalid_state", 400, "Invalid Hevy callback. Start again from Nakama settings.");
    }
    await completeHevyOAuth(access.user.id, {
      state: params.get("state"), browser: request.cookies.get(HEVY_OAUTH_COOKIE)?.value,
      code: params.get("code"), error: params.get("error"),
    });
    disconnectChats(access.user.id);
    const target = new URL("/", origin);
    target.searchParams.set("hevy_oauth", "connected");
    return finish(access.session.respond(NextResponse.redirect(target, 303)));
  } catch (error) {
    if (!(error instanceof HevyConnectionError)) throw error;
    // Only the enum code reaches the URL: never provider text, codes or tokens.
    const code = error instanceof HevyOAuthError && CALLBACK_ERROR_CODES.has(error.code) ? error.code : "unknown";
    const target = new URL("/", origin);
    target.searchParams.set("hevy_oauth", "error");
    target.searchParams.set("code", code);
    return finish(access.session.respond(NextResponse.redirect(target, 303)));
  }
}
