import { NextRequest, NextResponse } from "next/server";
import { requireBetaUser } from "@/lib/auth";
import { getAppOrigin } from "@/lib/app-origin";
import { HevyConnectionError } from "@/lib/hevy-connection";
import { beginHevyOAuth, HEVY_OAUTH_COOKIE, HEVY_OAUTH_PATH, HEVY_OAUTH_STATE_SECONDS, HevyOAuthError } from "@/lib/hevy-oauth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const origin = getAppOrigin(request);
  if (request.headers.get("origin") !== origin) {
    return NextResponse.json({ error: "This request must come from Nakama." }, { status: 403 });
  }
  const access = await requireBetaUser(request);
  if (!access.ok) return access.response;
  try {
    const started = await beginHevyOAuth(access.user.id, origin);
    const response = access.session.json({ authorization_url: started.authorizationUrl });
    response.cookies.set(HEVY_OAUTH_COOKIE, started.browser, {
      httpOnly: true, secure: new URL(origin).protocol === "https:",
      sameSite: "lax", path: HEVY_OAUTH_PATH, maxAge: HEVY_OAUTH_STATE_SECONDS,
    });
    return response;
  } catch (error) {
    if (!(error instanceof HevyConnectionError)) throw error;
    return access.session.json({
      error: error.message, code: error instanceof HevyOAuthError ? error.code : "configuration_unavailable",
    }, error.status);
  }
}
