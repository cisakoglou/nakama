import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireBetaUser } from "@/lib/auth";
import { getAppOrigin } from "@/lib/app-origin";
import { getReportStatus, ReportSettingsError, setReportsEnabled, type ReportStatus } from "@/lib/hevy-reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ enabled: z.boolean() }).strict();
type Session = Extract<Awaited<ReturnType<typeof requireBetaUser>>, { ok: true }>["session"];

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function respond(session: Session, status: ReportStatus | null) {
  if (!status) {
    return noStore(session.json({ error: "Reports settings apply to Hevy connections made with Connect Hevy.", code: "not_oauth" }, 404));
  }
  return noStore(session.json(status));
}

async function run(session: Session, action: () => Promise<ReportStatus | null>) {
  try {
    return respond(session, await action());
  } catch (error) {
    if (!(error instanceof ReportSettingsError)) throw error;
    return noStore(session.json({ error: error.message }, 503));
  }
}

export async function GET(request: NextRequest) {
  const access = await requireBetaUser(request);
  if (!access.ok) return noStore(access.response);
  return run(access.session, () => getReportStatus(access.user.id));
}

export async function PUT(request: NextRequest) {
  if (request.headers.get("origin") !== getAppOrigin(request)) {
    return noStore(NextResponse.json({ error: "This request must come from Nakama." }, { status: 403 }));
  }
  const access = await requireBetaUser(request);
  if (!access.ok) return noStore(access.response);
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return noStore(access.session.json({ error: "Send { \"enabled\": true | false }." }, 400));
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return noStore(access.session.json({ error: "Send { \"enabled\": true | false }." }, 400));
  return run(access.session, () => setReportsEnabled(access.user.id, parsed.data.enabled));
}
