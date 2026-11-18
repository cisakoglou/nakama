import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireBetaUser } from "@/lib/auth";
import { HevyConnectionError, loadHevyConnection } from "@/lib/hevy-connection";
import {
  RANGES, addDays, buildRangeChart, hevyWindow, isRealDate, rangeStart, sessionsFromHistory, templateIdSchema,
} from "@/lib/exercise-series";

const HEVY_API = "https://api.hevyapp.com/v1";

const paramsSchema = z.object({
  template: templateIdSchema,
  range: z.enum(RANGES),
  end: z.string().refine(isRealDate),
}).strict();

class HevyUnavailable extends Error {
  constructor(public readonly status: number | null) { super(`Hevy request failed (${status ?? "network"})`); }
}

async function hevyGet(apiKey: string, path: string, params: Record<string, string> = {}) {
  const url = new URL(`${HEVY_API}${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "api-key": apiKey, accept: "application/json" },
      cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (!(error instanceof TypeError) && !(error instanceof DOMException)) throw error;
    throw new HevyUnavailable(null);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new HevyUnavailable(response.status);
  }
  return response.json() as Promise<unknown>;
}

const historySchema = z.object({ exercise_history: z.array(z.unknown()) });
const templateSchema = z.object({ title: z.string() });

/** Template title for the chart; the renderer keeps its own block title, so failures fall back quietly. */
async function templateTitle(apiKey: string, templateId: string) {
  try {
    const parsed = templateSchema.safeParse(await hevyGet(apiKey, `/exercise_templates/${encodeURIComponent(templateId)}`));
    return parsed.success ? parsed.data.title : "Exercise";
  } catch (error) {
    if (!(error instanceof HevyUnavailable)) throw error;
    return "Exercise";
  }
}

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

  let apiKey: string;
  try {
    ({ apiKey } = await loadHevyConnection(access.user.id));
  } catch (error) {
    if (!(error instanceof HevyConnectionError)) throw error;
    return error.status === 409 ? fail("Connect your Hevy account to see longer ranges.", 404) : fail(error.message, error.status);
  }

  const start = rangeStart(end, range);
  let entries: unknown[];
  let title: string;
  try {
    const [history, name] = await Promise.all([
      hevyGet(apiKey, `/exercise_history/${encodeURIComponent(template)}`, hevyWindow(start, end)).catch((error) => {
        // Hevy answers 404 when an exercise has no history.
        if (error instanceof HevyUnavailable && error.status === 404) return { exercise_history: [] };
        throw error;
      }),
      templateTitle(apiKey, template),
    ]);
    const parsed = historySchema.safeParse(history);
    if (!parsed.success) throw new HevyUnavailable(200);
    entries = parsed.data.exercise_history;
    title = name;
  } catch (error) {
    if (!(error instanceof HevyUnavailable)) throw error;
    console.error("Hevy exercise history request failed", { status: error.status });
    return fail("Hevy is temporarily unavailable. Please try again.", 502);
  }

  const result = buildRangeChart({
    sessions: sessionsFromHistory(entries, template, start, end), range, end, templateId: template, title, units,
  });
  if (!result) return fail("No sessions of this exercise in this range.", 404);
  const response = access.session.json(result);
  response.headers.set("Cache-Control", "private, max-age=300");
  return response;
}
