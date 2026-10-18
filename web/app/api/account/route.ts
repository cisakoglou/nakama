import { NextRequest } from "next/server";
import { requireBetaUser } from "@/lib/auth";
import { connectionSchema } from "@/lib/hevy-types";

export async function GET(request: NextRequest) {
  const access = await requireBetaUser(request);
  if (!access.ok) return access.response;

  const { data: profile, error } = await access.session.client
    .from("profiles")
    .select("*")
    .eq("user_id", access.user.id)
    .maybeSingle();

  if (error) {
    console.error("Unable to load training profile", { code: error.code });
    return access.session.json({ error: "Unable to load your profile. Please try again." }, 503);
  }
  const { data: status, error: statusError } = await access.session.client.rpc("hevy_connection_status");
  const connection = connectionSchema.safeParse(status);
  if (statusError || !connection.success) {
    console.error("Unable to load Hevy connection status", { code: statusError?.code ?? "invalid_response" });
    return access.session.json({ error: "Unable to load your Hevy connection. Please try again." }, 503);
  }
  return access.session.json({ user: access.user, profile, connection: connection.data });
}
