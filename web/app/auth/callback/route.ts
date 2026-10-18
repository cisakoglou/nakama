import { NextRequest, NextResponse } from "next/server";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { createRequestClient } from "@/lib/supabase/server";
import { getAppOrigin } from "@/lib/app-origin";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const target = new URL("/", getAppOrigin(request));
  if (!code) {
    target.searchParams.set(
      "auth_error",
      request.nextUrl.searchParams.get("error_code") === "otp_expired" ? "link_expired" : "sign_in_failed",
    );
    return NextResponse.redirect(target);
  }

  let session;
  try {
    session = createRequestClient(request);
  } catch (error) {
    if (!(error instanceof SupabaseConfigurationError)) throw error;
    return NextResponse.json({ error: error.message }, { status: 503 });
  }

  const { error } = await session.client.auth.exchangeCodeForSession(code);
  if (error) {
    target.searchParams.set("auth_error", "sign_in_failed");
  }
  return session.redirect(target);
}
