import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireBetaUser } from "@/lib/auth";
import { HevyConnectionError } from "@/lib/hevy-connection";
import { HevyOAuthError } from "@/lib/hevy-oauth";
import { createHevyClient, HevyRequestError, type HevyClient } from "@/lib/hevy-client";
import {
  RANGES, addDays, buildRangeChart, hevyWindow, isRealDate, rangeStart, sessionsFromHistory, templateIdSchema,
} from "@/lib/exercise-series";

const paramsSchema = z.object({
  template: templateIdSchema,
  range: z.enum(RANGES),
  end: z.string().refine(isRealDate),
}).strict();

const historySchema = z.object({ exercise_history: z.array(z.unknown()) });
/** The renderer keeps the report's own title, so no extra Hevy request is spent on the template name. */
const PLACEHOLDER_TITLE = "Exercise";

export async function GET(request: NextRequest) {
  const access = await requireBetaUser(request);
  if (!access.ok) return access.response;
  const fail = (error: string, status: number) => {
    const response = access.session.json({ error }, status);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  };

  const params = paramsSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  // A day of slack for time zones ahead of UTC.
  const latestEnd = addDays(new Date().toISOString().slice(0, 10), 1);
  if (!params.success || params.data.end > latestEnd) return fail("Invalid chart range request.", 400);
  const { template, range, end } = params.data;

  const { data: profile, error: profileError } = await access.session.client
    .from("profiles").select("units").eq("user_id", access.user.id).maybeSingle();
  if (profileError) {
    console.error("Unable to load units for exercise history", { code: profileError.code });
    return fail("Unable to load your profile. Please try again.", 503);
  }
  const units = profile?.units === "lb" ? "lb" : "kg";

  let hevy: HevyClient;
  try {
    hevy = await createHevyClient(access.user.id, request.signal);
  } catch (error) {
    if (!(error instanceof HevyConnectionError)) throw error;
    return error.status === 409 && !(error instanceof HevyOAuthError)
      ? fail("Connect your Hevy account to see longer ranges.", 404) : fail(error.message, error.status);
  }

  const start = rangeStart(end, range);
  let entries: unknown[];
  try {
    const history = await hevy.request(`/exercise_history/${encodeURIComponent(template)}`, { query: hevyWindow(start, end) })
      .catch((error) => {
        // Hevy answers 404 when an exercise has no history.
        if (error instanceof HevyRequestError && error.providerStatus === 404) return { exercise_history: [] };
        throw error;
      });
    const parsed = historySchema.safeParse(history);
    if (!parsed.success) throw new HevyRequestError(200);
    entries = parsed.data.exercise_history;
  } catch (error) {
    if (!(error instanceof HevyConnectionError)) throw error;
    console.error("Hevy exercise history request failed", {
      status: error instanceof HevyRequestError ? error.providerStatus : error.status,
    });
    return fail(error.message, error.status);
  }

  const result = buildRangeChart({
    sessions: sessionsFromHistory(entries, template, start, end), range, end, templateId: template, title: PLACEHOLDER_TITLE, units,
  });
  if (!result) return fail("No sessions of this exercise in this range.", 404);
  const response = access.session.json(result);
  response.headers.set("Cache-Control", "private, max-age=300");
  return response;
}
