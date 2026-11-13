import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { HevyConnectionError, loadHevyConnection, storage } from "@/lib/hevy-connection";
import type { Database } from "@/lib/supabase/database";
import {
  generateWorkoutReport, hevyWorkoutSchema, renderWorkoutReport, type HevyWorkout,
} from "@/lib/workout-report";

const HEVY_API = "https://api.hevyapp.com/v1";
export const MAX_REPORT_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];
const HISTORY_PAGES = 3;
const HISTORY_LIMIT = 30;
const MAX_JOBS_PER_DRAIN = 50;
const SWEEP_INTERVAL_MS = 30_000;

type Db = SupabaseClient<Database>;
type FailureCode = "connection_unavailable" | "hevy_unavailable" | "invalid_workout" | "report_failed" | "delivery_failed";
type Job = Database["public"]["Functions"]["claim_next_workout_report"]["Returns"][number];

export type WorkoutReportDrainSummary = {
  claimed: number;
  delivered: number;
  failed: number;
  exhausted: number;
  skipped: number;
};

export class WorkoutReportStorageError extends Error {}

class HevyRequestError extends Error {
  constructor(public readonly status: number | null) { super(`Hevy request failed (${status ?? "network"})`); }
}

const workoutsPageSchema = z.object({ page: z.number().int(), page_count: z.number().int(), workouts: z.array(z.unknown()) });

async function hevyGet(apiKey: string, path: string, params: Record<string, string | number> = {}) {
  const url = new URL(`${HEVY_API}${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "api-key": apiKey, accept: "application/json" },
      cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (!(error instanceof TypeError) && !(error instanceof DOMException)) throw error;
    throw new HevyRequestError(null);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new HevyRequestError(response.status);
  }
  return response.json() as Promise<unknown>;
}

async function recentWorkouts(apiKey: string) {
  const workouts: unknown[] = [];
  for (let page = 1; page <= HISTORY_PAGES; page++) {
    let body: unknown;
    try {
      body = await hevyGet(apiKey, "/workouts", { page, pageSize: 10 });
    } catch (error) {
      // Hevy answers 404 for list pages past the end.
      if (error instanceof HevyRequestError && error.status === 404 && page > 1) break;
      throw error;
    }
    const parsed = workoutsPageSchema.safeParse(body);
    if (!parsed.success) throw new HevyRequestError(200);
    workouts.push(...parsed.data.workouts);
    if (page >= parsed.data.page_count) break;
  }
  return workouts.map(parseWorkout).filter((workout): workout is HevyWorkout => workout !== null);
}

function parseWorkout(value: unknown): HevyWorkout | null {
  const parsed = hevyWorkoutSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function reportTitle(workout: HevyWorkout) {
  const name = workout.title.replace(/\s+/g, " ").trim() || "Workout";
  return `Workout report: ${name}`.slice(0, 80).replace(/[\uD800-\uDBFF]$/, "").trim();
}

function dbFailure(code: string) {
  console.error("Workout report database operation failed", { code });
  return new WorkoutReportStorageError("Workout report storage is unavailable.");
}

export function workoutReportQueue(db: Db) {
  return {
    async claimNext(): Promise<Job | null> {
      const { data, error } = await db.rpc("claim_next_workout_report", { p_max_attempts: MAX_REPORT_ATTEMPTS });
      if (error) throw dbFailure(error.code);
      return data?.[0] ?? null;
    },
    async units(userId: string): Promise<"kg" | "lb"> {
      const { data, error } = await db.from("profiles").select("units").eq("user_id", userId).maybeSingle();
      if (error) throw dbFailure(error.code);
      return data?.units === "lb" ? "lb" : "kg";
    },
    async deliver(job: Job, workout: HevyWorkout, content: string) {
      const { error } = await db.from("chat_conversations").insert({
        id: job.conversation_id, user_id: job.user_id, title: reportTitle(workout),
        messages: [{ id: `workout-report-${workout.id}`.slice(0, 128), role: "assistant", content }],
      });
      // A prior attempt inserted this conversation but stopped before marking delivery.
      if (error && error.code !== "23505") throw dbFailure(error.code);
    },
    async finish(job: Job, status: "delivered" | "failed" | "skipped", lastError: string | null, now: Date) {
      const retryDelay = RETRY_DELAYS_MS[Math.min(job.attempts, RETRY_DELAYS_MS.length) - 1] ?? 0;
      const { error } = await db.from("workout_reports").update({
        status, last_error: lastError, updated_at: now.toISOString(),
        available_at: new Date(now.getTime() + (status === "failed" ? retryDelay : 0)).toISOString(),
      }).eq("user_id", job.user_id).eq("workout_id", job.workout_id).eq("status", "processing");
      if (error) throw dbFailure(error.code);
    },
  };
}

type Queue = ReturnType<typeof workoutReportQueue>;
type Outcome = { status: "delivered" | "skipped"; reason: string | null } | { status: "failed"; reason: FailureCode; error: unknown };

async function processJob(queue: Queue, job: Job): Promise<Outcome> {
  let apiKey: string;
  try {
    const connection = await loadHevyConnection(job.user_id);
    if (connection.revision !== job.connection_revision) return { status: "skipped", reason: "connection_changed" };
    apiKey = connection.apiKey;
  } catch (error) {
    if (!(error instanceof HevyConnectionError)) throw error;
    if (error.status === 409) return { status: "skipped", reason: "connection_removed" };
    return { status: "failed", reason: "connection_unavailable", error };
  }

  let workout: HevyWorkout | null;
  try {
    workout = parseWorkout(await hevyGet(apiKey, `/workouts/${encodeURIComponent(job.workout_id)}`));
  } catch (error) {
    if (!(error instanceof HevyRequestError)) throw error;
    if (error.status === 404) return { status: "skipped", reason: "workout_not_found" };
    return { status: "failed", reason: "hevy_unavailable", error };
  }
  if (!workout || workout.id !== job.workout_id) return { status: "failed", reason: "invalid_workout", error: null };

  let content: string;
  try {
    const units = await queue.units(job.user_id);
    const start = Date.parse(workout.start_time);
    const history = (await recentWorkouts(apiKey))
      .filter((past) => past.id !== workout.id && Date.parse(past.start_time) < start)
      .sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time))
      .slice(0, HISTORY_LIMIT);
    content = renderWorkoutReport(generateWorkoutReport(workout, history, units));
  } catch (error) {
    if (error instanceof HevyRequestError) return { status: "failed", reason: "hevy_unavailable", error };
    return { status: "failed", reason: "report_failed", error };
  }

  try {
    await queue.deliver(job, workout, content);
  } catch (error) {
    if (!(error instanceof WorkoutReportStorageError)) throw error;
    return { status: "failed", reason: "delivery_failed", error };
  }
  return { status: "delivered", reason: null };
}

export async function drainWorkoutReports(db: Db = storage(), now: () => Date = () => new Date()) {
  const queue = workoutReportQueue(db);
  const summary: WorkoutReportDrainSummary = { claimed: 0, delivered: 0, failed: 0, exhausted: 0, skipped: 0 };
  for (let index = 0; index < MAX_JOBS_PER_DRAIN; index++) {
    const job = await queue.claimNext();
    if (!job) break;
    summary.claimed++;
    const outcome = await processJob(queue, job);
    await queue.finish(job, outcome.status, outcome.reason, now());
    summary[outcome.status]++;
    if (outcome.status !== "failed") continue;
    const exhausted = job.attempts >= MAX_REPORT_ATTEMPTS;
    console.error(exhausted ? "Workout report retries exhausted" : "Workout report attempt failed", {
      userId: job.user_id, workoutId: job.workout_id, code: outcome.reason, attempt: job.attempts,
      error: outcome.error instanceof Error ? outcome.error.message : undefined,
    });
    if (exhausted) summary.exhausted++;
  }
  return summary;
}

// Next.js bundles instrumentation and route handlers separately, so worker state lives on globalThis.
const worker = ((globalThis as { __nakamaWorkoutReportWorker?: {
  draining: Promise<void> | null; rerun: boolean; sweep: ReturnType<typeof setInterval> | null;
} }).__nakamaWorkoutReportWorker ??= { draining: null, rerun: false, sweep: null });

function drainSafely() {
  if (worker.draining) {
    worker.rerun = true;
    return worker.draining;
  }
  worker.draining = (async () => {
    do {
      worker.rerun = false;
      try {
        await drainWorkoutReports();
      } catch (error) {
        // Jobs stay in Postgres; the next wake or sweep retries them.
        console.error("Workout report worker drain failed", { error: error instanceof Error ? error.message : "unknown" });
      }
    } while (worker.rerun);
  })().finally(() => { worker.draining = null; });
  return worker.draining;
}

// Nudges the in-process worker after a durable enqueue. The job is already committed,
// so a lost nudge only delays processing until the next sweep.
export function wakeWorkoutReportWorker() {
  if (worker.sweep) void drainSafely();
}

export function startWorkoutReportWorker() {
  if (worker.sweep) return;
  worker.sweep = setInterval(() => void drainSafely(), SWEEP_INTERVAL_MS);
  worker.sweep.unref();
  void drainSafely();
}

export function stopWorkoutReportWorker() {
  if (worker.sweep) clearInterval(worker.sweep);
  worker.sweep = null;
  return worker.draining ?? Promise.resolve();
}
