import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { createRequestClient } from "@/lib/supabase/server";

export async function requireBetaUser(request: NextRequest) {
  let session;
  try {
    session = createRequestClient(request);
  } catch (error) {
    if (!(error instanceof SupabaseConfigurationError)) throw error;
    return {
      ok: false as const,
      response: NextResponse.json({ error: error.message }, {
        status: 503,
        headers: { "Cache-Control": "private, no-store" },
      }),
    };
  }

  const { data, error } = await session.client.auth.getUser();
  if (error) {
    if (isAuthSessionMissingError(error) || [400, 401, 403].includes(error.status ?? 0)) {
      return { ok: false as const, response: session.json({ error: "Please sign in." }, 401) };
    }
    console.error("Unable to verify Supabase session", { code: error.code, status: error.status });
    return { ok: false as const, response: session.json({ error: "Sign-in is temporarily unavailable." }, 503) };
  }
  if (!data.user) {
    return { ok: false as const, response: session.json({ error: "Please sign in." }, 401) };
  }
  if (!data.user.email || !data.user.email_confirmed_at) {
    return { ok: false as const, response: session.json({ error: "A verified email is required." }, 403) };
  }

  const { data: invited, error: inviteError } = await session.client.rpc("has_beta_access");
  if (inviteError) {
    console.error("Unable to check beta invitation", { code: inviteError.code });
    return { ok: false as const, response: session.json({ error: "Unable to check your invitation. Please try again." }, 503) };
  }
  if (invited !== true) {
    return { ok: false as const, response: session.json({ error: "Nakama is invite-only. Please use your invited email address." }, 403) };
  }

  return {
    ok: true as const,
    session,
    user: { id: data.user.id, email: data.user.email },
  };
}
