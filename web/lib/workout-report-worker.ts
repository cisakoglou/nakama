import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { HevyConnectionError, storage } from "@/lib/hevy-connection";
import { HevyOAuthError } from "@/lib/hevy-oauth";
import { createHevyClient, HevyConnectionChangedError, HevyRequestError, type HevyClient } from "@/lib/hevy-client";
import { WORKOUT_REPORT_FIRST_ATTEMPT_DELAY_MS } from "@/lib/hevy-webhook";
import { notifyReportReady, type ReportReadyPayload } from "@/lib/push";
import type { Database } from "@/lib/supabase/database";
import {
  generateWorkoutReport, hevyWorkoutSchema, historyFromExerciseHistory, renderWorkoutReport, type HevyWorkout,
} from "@/lib/workout-report";

export const MAX_REPORT_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];
// A 404 usually means Hevy's API has not caught up with its webhook yet, so it is retried. Three attempts span
// ~6 minutes after the webhook (20 s, +1 min, +5 min); a workout still missing then was almost certainly deleted,
// and a report arriving hours later (the remaining backoff steps) is not worth the extra Hevy calls.
export const WORKOUT_NOT_FOUND_MAX_ATTEMPTS = 3;
// Wake drains run just after a new job becomes due, with slack for app/database clock skew.
const WAKE_DELAY_MS = WORKOUT_REPORT_FIRST_ATTEMPT_DELAY_MS + 1_000;
const HISTORY_MAX_EXERCISES = 20;
const HISTORY_CONCURRENCY = 3;
const MAX_JOBS_PER_DRAIN = 50;
const SWEEP_INTERVAL_MS = 30_000;

type Db = SupabaseClient<Database>;
type FailureCode = "connection_unavailable" | "hevy_unavailable" | "workout_not_found" | "invalid_workout" | "report_failed" | "delivery_failed";
type Job = Database["public"]["Functions"]["claim_next_workout_report"]["Returns"][number];

export type WorkoutReportDrainSummary = {
  claimed: number;
  delivered: number;
  failed: number;
  exhausted: number;
  skipped: number;
};

export class WorkoutReportStorageError extends Error {}

const exerciseHistorySchema = z.object({ exercise_history: z.array(z.unknown()) });

/**
 * Full (all-time) history per distinct exercise in the workout, grouped into per-workout sessions.
 * No date range is sent: the report itself narrows to 90 days for comparisons and charts, and uses
 * everything only for all-time PRs.
 */
async function exerciseHistory(hevy: HevyClient, workout: HevyWorkout) {
  const titles = new Map<string, string>();
  for (const exercise of workout.exercises) {
    if (!titles.has(exercise.exercise_template_id)) titles.set(exercise.exercise_template_id, exercise.title);
  }
  const targets = [...titles].slice(0, HISTORY_MAX_EXERCISES);
  const responses: { templateId: string; title: string; entries: unknown[] }[] = new Array(targets.length);
  let next = 0;
  const run = async () => {
    while (next < targets.length) {
      const index = next++;
      const [templateId, title] = targets[index];
      let body: unknown;
      try {
        body = await hevy.request(`/exercise_history/${encodeURIComponent(templateId)}`);
      } catch (error) {
        // No history, or a deleted/custom template: this exercise just has nothing to compare.
        if (error instanceof HevyRequestError && error.providerStatus === 404) {
          responses[index] = { templateId, title, entries: [] };
          continue;
        }
        throw error;
      }
      const parsed = exerciseHistorySchema.safeParse(body);
      if (!parsed.success) throw new HevyRequestError(200);
      responses[index] = { templateId, title, entries: parsed.data.exercise_history };
    }
  };
  await Promise.all(Array.from({ length: Math.min(HISTORY_CONCURRENCY, targets.length) }, run));
  const start = Date.parse(workout.start_time);
  return historyFromExerciseHistory(responses, workout.id).filter((past) => Date.parse(past.end_time) < start);
}

function parseWorkout(value: unknown): HevyWorkout | null {
  const parsed = hevyWorkoutSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function workoutName(workout: HevyWorkout) {
  return workout.title.replace(/\s+/g, " ").trim() || "Workout";
}

function reportTitle(workout: HevyWorkout) {
  return `Workout report: ${workoutName(workout)}`.slice(0, 80).replace(/[\uD800-\uDBFF]$/, "").trim();
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
type Outcome = { status: "delivered"; reason: null; title: string } | { status: "skipped"; reason: string }
  | { status: "failed"; reason: FailureCode; error: unknown };
type Notify = (userId: string, payload: ReportReadyPayload) => Promise<unknown>;

async function processJob(queue: Queue, job: Job): Promise<Outcome> {
  let hevy: HevyClient;
  try {
    hevy = await createHevyClient(job.user_id);
    if (hevy.revision !== job.connection_revision) return { status: "skipped", reason: "connection_changed" };
  } catch (error) {
    if (!(error instanceof HevyConnectionError)) throw error;
    if (error.status === 409 && !(error instanceof HevyOAuthError)) return { status: "skipped", reason: "connection_removed" };
    return { status: "failed", reason: "connection_unavailable", error };
  }

  let workout: HevyWorkout | null;
  try {
    workout = parseWorkout(await hevy.request(`/workouts/${encodeURIComponent(job.workout_id)}`));
  } catch (error) {
    if (error instanceof HevyConnectionChangedError) return { status: "skipped", reason: "connection_changed" };
    if (!(error instanceof HevyConnectionError)) throw error;
    if (error instanceof HevyRequestError && error.providerStatus === 404) {
      return job.attempts >= WORKOUT_NOT_FOUND_MAX_ATTEMPTS
        ? { status: "skipped", reason: "workout_not_found" }
        : { status: "failed", reason: "workout_not_found", error };
    }
    return { status: "failed", reason: "hevy_unavailable", error };
  }
  if (!workout || workout.id !== job.workout_id) return { status: "failed", reason: "invalid_workout", error: null };

  let content: string;
  try {
    const units = await queue.units(job.user_id);
    const history = await exerciseHistory(hevy, workout);
    content = renderWorkoutReport(generateWorkoutReport(workout, history, units));
  } catch (error) {
    if (error instanceof HevyConnectionChangedError) return { status: "skipped", reason: "connection_changed" };
    if (error instanceof HevyConnectionError) return { status: "failed", reason: "hevy_unavailable", error };
    return { status: "failed", reason: "report_failed", error };
  }

  try {
    await queue.deliver(job, workout, content);
  } catch (error) {
    if (!(error instanceof WorkoutReportStorageError)) throw error;
    return { status: "failed", reason: "delivery_failed", error };
  }
  return { status: "delivered", reason: null, title: workoutName(workout).slice(0, 80) };
}

// Fire-and-forget so a slow push service never delays other jobs; failures are logged only.
function notifyInBackground(notify: Notify, job: Job, title: string) {
  void Promise.resolve()
    .then(() => notify(job.user_id, { conversationId: job.conversation_id, title }))
    .catch((error: unknown) => {
      console.error("Workout report notification failed", { error: error instanceof Error ? error.message : "unknown" });
    });
}

export async function drainWorkoutReports(
  db: Db = storage(), now: () => Date = () => new Date(), notify: Notify = notifyReportReady,
) {
  const queue = workoutReportQueue(db);
  const summary: WorkoutReportDrainSummary = { claimed: 0, delivered: 0, failed: 0, exhausted: 0, skipped: 0 };
  for (let index = 0; index < MAX_JOBS_PER_DRAIN; index++) {
    const job = await queue.claimNext();
    if (!job) break;
    summary.claimed++;
    const outcome = await processJob(queue, job);
    await queue.finish(job, outcome.status, outcome.reason, now());
    summary[outcome.status]++;
    // Notify only after the job is durably marked delivered: delivered jobs are never reclaimed, and a
    // retry that hits the 23505 path means the earlier attempt stopped before this point, so it never notified.
    const context = { userId: job.user_id, workoutId: job.workout_id, attempt: job.attempts };
    if (outcome.status === "delivered") {
      console.info("Workout report delivered", context);
      notifyInBackground(notify, job, outcome.title);
      continue;
    }
    if (outcome.status === "skipped") {
      console.warn("Workout report skipped", { ...context, reason: outcome.reason });
      continue;
    }
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
  wakes?: Set<ReturnType<typeof setTimeout>>;
} }).__nakamaWorkoutReportWorker ??= { draining: null, rerun: false, sweep: null });
const wakes = (worker.wakes ??= new Set());

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

// Nudges the in-process worker after a durable enqueue, timed for when the new job becomes due. The job is
// already committed, so a lost nudge only delays processing until the next sweep.
export function wakeWorkoutReportWorker() {
  if (!worker.sweep) return;
  const timer = setTimeout(() => {
    wakes.delete(timer);
    void drainSafely();
  }, WAKE_DELAY_MS);
  timer.unref();
  wakes.add(timer);
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
  for (const timer of wakes) clearTimeout(timer);
  wakes.clear();
  return worker.draining ?? Promise.resolve();
}
