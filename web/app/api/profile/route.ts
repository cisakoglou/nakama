import { NextRequest, NextResponse } from "next/server";
import { requireBetaUser } from "@/lib/auth";
import { profileInputSchema } from "@/lib/profile";
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
    return access.session.json({ error: "Send a valid profile." }, 400);
  }

  const result = profileInputSchema.safeParse(body);
  if (!result.success) {
    return access.session.json({
      error: "Choose a goal, experience level, equipment, units, and between 1 and 7 training days.",
    }, 400);
  }

  const { data: profile, error } = await access.session.client
    .from("profiles")
    .upsert({ ...result.data, user_id: access.user.id }, { onConflict: "user_id" })
    .select("*")
    .single();

  if (error) {
    console.error("Unable to save training profile", { code: error.code });
    return access.session.json({ error: "Your profile could not be saved. Please try again." }, 503);
  }
  return access.session.json({ profile });
}
