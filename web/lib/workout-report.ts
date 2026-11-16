import { z } from "zod";

const metricSchema = z.number().finite().nullish();
const setSchema = z.object({
  index: z.number().int().optional(),
  type: z.enum(["normal", "warmup", "dropset", "failure"]).optional(),
  weight_kg: metricSchema,
  reps: metricSchema,
  distance_meters: metricSchema,
  duration_seconds: metricSchema,
  rpe: metricSchema,
  custom_metric: metricSchema,
});
const exerciseSchema = z.object({
  index: z.number().int().optional(),
  title: z.string(),
  notes: z.string().nullish(),
  exercise_template_id: z.string().min(1),
  superset_id: z.number().nullish(),
  sets: z.array(setSchema),
});

export const hevyWorkoutSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  routine_id: z.string().nullish(),
  description: z.string().nullish(),
  start_time: z.string().datetime({ offset: true }),
  end_time: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }).optional(),
  created_at: z.string().datetime({ offset: true }).optional(),
  exercises: z.array(exerciseSchema),
});

export type HevyWorkout = z.infer<typeof hevyWorkoutSchema>;

/**
 * Tolerant parser for history workouts: sets or exercises that fail validation
 * (e.g. an unknown set type) are dropped instead of discarding the whole workout.
 */
export function parseHistoryWorkout(value: unknown): HevyWorkout | null {
  const strict = hevyWorkoutSchema.safeParse(value);
  if (strict.success) return strict.data;
  if (typeof value !== "object" || value === null || !Array.isArray((value as { exercises?: unknown }).exercises)) return null;
  const raw = value as { exercises: unknown[] };
  const exercises = raw.exercises.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { sets, ...rest } = entry as { sets?: unknown };
    if (!Array.isArray(sets)) return [];
    const parsed = exerciseSchema.safeParse({
      ...rest, sets: sets.filter((set) => setSchema.safeParse(set).success),
    });
    return parsed.success ? [parsed.data] : [];
  });
  const lenient = hevyWorkoutSchema.safeParse({ ...raw, exercises });
  return lenient.success ? lenient.data : null;
}

const historyEntrySchema = z.object({
  workout_id: z.string().min(1),
  workout_title: z.string().nullish(),
  workout_start_time: z.string().datetime({ offset: true }),
  workout_end_time: z.string().datetime({ offset: true }),
  exercise_template_id: z.string().min(1),
  set_type: z.string().nullish(),
});

/**
 * Adapts Hevy exercise_history responses (one entry per set, one request per exercise template)
 * into per-workout sessions. Entries that fail validation are dropped, never whole histories.
 */
export function historyFromExerciseHistory(
  responses: { templateId: string; title: string; entries: unknown[] }[],
  excludeWorkoutId: string,
): HevyWorkout[] {
  const workouts = new Map<string, HevyWorkout>();
  const exercises = new Map<string, Exercise>();
  for (const { templateId, title, entries } of responses) {
    for (const raw of entries) {
      const entry = historyEntrySchema.safeParse(raw);
      const set = setSchema.safeParse(raw === null || typeof raw !== "object" ? null : {
        type: (raw as { set_type?: unknown }).set_type,
        weight_kg: (raw as { weight_kg?: unknown }).weight_kg,
        reps: (raw as { reps?: unknown }).reps,
        distance_meters: (raw as { distance_meters?: unknown }).distance_meters,
        duration_seconds: (raw as { duration_seconds?: unknown }).duration_seconds,
        rpe: (raw as { rpe?: unknown }).rpe,
        custom_metric: (raw as { custom_metric?: unknown }).custom_metric,
      });
      if (!entry.success || !set.success || entry.data.exercise_template_id !== templateId
        || entry.data.workout_id === excludeWorkoutId) continue;
      const data = entry.data;
      let workout = workouts.get(data.workout_id);
      if (!workout) {
        workout = {
          id: data.workout_id, title: data.workout_title ?? "Workout",
          start_time: data.workout_start_time, end_time: data.workout_end_time, exercises: [],
        };
        workouts.set(data.workout_id, workout);
      }
      const key = `${data.workout_id}\u0000${templateId}`;
      let exercise = exercises.get(key);
      if (!exercise) {
        exercise = { title, exercise_template_id: templateId, sets: [] };
        exercises.set(key, exercise);
        workout.exercises.push(exercise);
      }
      exercise.sets.push({ ...set.data, index: exercise.sets.length });
    }
  }
  return [...workouts.values()];
}
type Exercise = HevyWorkout["exercises"][number];
type WorkoutSet = Exercise["sets"][number];
type Units = "kg" | "lb";
type Summary =
  | { kind: "strength"; e1rm: number | null; topWeight: number; topReps: number; volume: number; sets: number }
  | { kind: "bodyweight"; bestReps: number; totalReps: number; sets: number }
  | { kind: "pace"; distance: number; pace: number; sets: number };

export type WorkoutReport = {
  workoutId: string;
  title: string;
  summary: string;
  achievements: string[];
  patterns: string[];
  limitations: string[];
};

const HISTORY_DAYS = 90;
const TREND_SESSIONS = 4;
const SAME_E1RM = 0.02;
const MIN_AVERAGE_SESSIONS = 3;
const KG_TO_LB = 2.2046226218;

function label(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 120);
}

function positive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Estimated one-rep max (Epley) from a single set; only for 1-12 reps at a positive load. */
function epley(set: WorkoutSet) {
  return positive(set.weight_kg) && positive(set.reps) && set.reps <= 12
    ? set.weight_kg * (1 + set.reps / 30) : null;
}

function workingSets(exercise: Exercise) {
  const sets = exercise.sets.filter((set) => set.type === "normal");
  return [...sets].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

function summarize(exercise: Exercise): Summary | null {
  const sets = workingSets(exercise);
  if (!sets.length) return null;
  if (sets.every((set) => positive(set.reps) && Number.isInteger(set.reps)
    && typeof set.weight_kg === "number" && set.weight_kg >= 0
    && !positive(set.distance_meters) && !positive(set.duration_seconds))) {
    const reps = sets.map((set) => set.reps as number);
    if (sets.every((set) => set.weight_kg === 0)) {
      return { kind: "bodyweight", bestReps: Math.max(...reps), totalReps: reps.reduce((a, b) => a + b, 0), sets: sets.length };
    }
    const estimates = sets.map(epley).filter((value): value is number => value !== null);
    const top = sets.reduce((best, set) => (set.weight_kg! > best.weight_kg!
      || (set.weight_kg === best.weight_kg && set.reps! > best.reps!) ? set : best));
    return {
      kind: "strength",
      e1rm: estimates.length ? Math.max(...estimates) : null,
      topWeight: top.weight_kg!, topReps: top.reps!,
      volume: sets.reduce((total, set) => total + set.weight_kg! * set.reps!, 0),
      sets: sets.length,
    };
  }
  if (sets.every((set) => positive(set.distance_meters) && positive(set.duration_seconds)
    && !positive(set.reps) && !positive(set.weight_kg))) {
    const distance = sets.reduce((total, set) => total + set.distance_meters!, 0);
    const duration = sets.reduce((total, set) => total + set.duration_seconds!, 0);
    return { kind: "pace", distance, pace: duration / distance * 1000, sets: sets.length };
  }
  return null;
}

/** Pace is only compared when total distance is within 5%. */
function comparable(current: Summary, previous: Summary) {
  if (current.kind !== previous.kind) return false;
  if (current.kind !== "pace" || previous.kind !== "pace") return true;
  return Math.abs(current.distance - previous.distance) / previous.distance <= 0.05;
}

function number(value: number) {
  return Number(value.toFixed(1)).toString();
}

function percent(change: number) {
  return `${change >= 0 ? "+" : ""}${number(change * 100)}%`;
}

function paceLabel(pace: number) {
  const seconds = Math.round(pace);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} /km recorded pace`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Day and month as written in the workout's own timestamp (no locale or timezone conversion). */
function shortDate(iso: string) {
  const match = /^\d{4}-(\d{2})-(\d{2})/.exec(iso);
  return match ? `${Number(match[2])} ${MONTHS[Number(match[1]) - 1]}` : "an earlier date";
}

/** The per-session metric used for every comparison. Higher is better except pace (seconds per km). */
function primaryValues(series: Summary[]): { values: number[]; name: string; format: (value: number, units: Units) => string } {
  const first = series[0];
  const weight = (kg: number, units: Units) => `${number(units === "lb" ? kg * KG_TO_LB : kg)} ${units}`;
  if (first.kind === "pace") {
    return { values: series.map((s) => (s as typeof first).pace), name: "recorded pace", format: (value) => paceLabel(value) };
  }
  if (first.kind === "bodyweight") {
    return { values: series.map((s) => (s as typeof first).bestReps), name: "best-set reps", format: (value) => `${number(value)} reps` };
  }
  const strengths = series as (typeof first)[];
  if (strengths.every((s) => s.e1rm !== null)) {
    return { values: strengths.map((s) => s.e1rm!), name: "estimated 1RM", format: weight };
  }
  return { values: strengths.map((s) => s.topWeight), name: "top set weight", format: weight };
}

function describe(current: Summary, previous: Summary, units: Units, change: number) {
  const w = (kg: number) => `${number(units === "lb" ? kg * KG_TO_LB : kg)} ${units}`;
  if (current.kind === "pace" && previous.kind === "pace") {
    return `${paceLabel(current.pace)} vs ${paceLabel(previous.pace)} (${current.sets} ${current.sets === 1 ? "set" : "sets"} vs ${previous.sets}, similar total distance)`;
  }
  if (current.kind === "bodyweight" && previous.kind === "bodyweight") {
    return `best set ${current.bestReps} vs ${previous.bestReps} reps (${percent(change)}); ${current.totalReps} total reps vs ${previous.totalReps}`;
  }
  if (current.kind === "strength" && previous.kind === "strength") {
    const parts = [];
    if (current.e1rm !== null && previous.e1rm !== null) {
      parts.push(`estimated 1RM ${w(current.e1rm)} vs ${w(previous.e1rm)} (${percent(change)})`);
    }
    parts.push(`top set ${w(current.topWeight)} x ${current.topReps} vs ${w(previous.topWeight)} x ${previous.topReps}`);
    parts.push(`total volume ${w(current.volume)} vs ${w(previous.volume)}`);
    return parts.join("; ");
  }
  return "";
}

function recentHistory(workout: HevyWorkout, history: HevyWorkout[]) {
  const start = Date.parse(workout.start_time);
  const oldest = start - HISTORY_DAYS * 24 * 60 * 60 * 1000;
  const seen = new Set([workout.id]);
  return [...history]
    .filter((entry) => Date.parse(entry.end_time) < start
      && Date.parse(entry.end_time) >= Date.parse(entry.start_time)
      && Date.parse(entry.start_time) >= oldest)
    .sort((a, b) => Date.parse(b.end_time) - Date.parse(a.end_time))
    .filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });
}

export function generateWorkoutReport(
  workout: HevyWorkout,
  history: HevyWorkout[],
  units: Units = "kg",
): WorkoutReport {
  const normalSets = workout.exercises.reduce((total, exercise) => total + workingSets(exercise).length, 0);
  const report: WorkoutReport = {
    workoutId: workout.id,
    title: label(workout.title) || "Workout",
    summary: `Logged ${workout.exercises.length} ${workout.exercises.length === 1 ? "exercise" : "exercises"} and ${normalSets} normal working ${normalSets === 1 ? "set" : "sets"}.`,
    achievements: [],
    patterns: [],
    limitations: [],
  };
  const recent = recentHistory(workout, history);
  let compared = 0;
  let timed = false;
  const templateIds = workout.exercises.map((exercise) => exercise.exercise_template_id);

  for (const exercise of workout.exercises) {
    const name = label(exercise.title) || "Exercise";
    if (templateIds.filter((id) => id === exercise.exercise_template_id).length !== 1) {
      report.limitations.push(`${name}: repeated exercise entries cannot be matched reliably.`);
      continue;
    }
    const current = summarize(exercise);
    if (!current) {
      report.limitations.push(`${name}: incomplete or unsupported normal-set metrics; no performance comparison made.`);
      continue;
    }
    timed ||= current.kind === "pace";
    const previousSessions = recent.flatMap((entry) => {
      const matches = entry.exercises.filter((candidate) =>
        candidate.exercise_template_id === exercise.exercise_template_id);
      return matches.length === 1 ? [{ exercise: matches[0], start: entry.start_time }] : [];
    });
    if (!previousSessions.length) {
      report.limitations.push(`${name}: first time logging this exercise in the last ${HISTORY_DAYS} days, so there is nothing to compare yet.`);
      continue;
    }
    const dated = previousSessions
      .map((session) => ({ summary: summarize(session.exercise), start: session.start }))
      .filter((entry): entry is { summary: Summary; start: string } => entry.summary !== null && comparable(current, entry.summary));
    if (!dated.length) {
      report.limitations.push(`${name}: earlier sessions in the last ${HISTORY_DAYS} days have no comparable normal-set metrics.`);
      continue;
    }
    const previous = dated.map((entry) => entry.summary);
    compared++;
    // Always the most recent comparable session, never a more favorable older one.
    const baseline = previous[0];
    const series = [current, ...previous.slice(0, TREND_SESSIONS - 1)];
    const { values, name: metric } = primaryValues(series);
    const lowerIsBetter = current.kind === "pace";
    const gain = (index: number, other: number) => (values[index] - values[other]) / values[other] * (lowerIsBetter ? -1 : 1);
    const change = gain(0, 1);

    // Same per-session metric over every comparable previous session in the window.
    const all = primaryValues([current, ...previous]);
    const currentValue = all.values[0];
    const earlier = all.values.slice(1);
    const relative = (reference: number) => (currentValue - reference) / reference * (lowerIsBetter ? -1 : 1);
    const clauses: string[] = [];
    let notable = false;
    if (earlier.length >= MIN_AVERAGE_SESSIONS) {
      const average = earlier.reduce((total, value) => total + value, 0) / earlier.length;
      const delta = relative(average);
      const shown = all.format(average, units);
      notable ||= Math.abs(delta) >= SAME_E1RM;
      clauses.push(Math.abs(delta) < SAME_E1RM ? `about the same as your 3-month average (${shown})`
        : lowerIsBetter ? `${number(Math.abs(delta) * 100)}% ${delta > 0 ? "faster" : "slower"} than your 3-month average (${shown})`
        : `${percent(delta)} vs your 3-month average (${shown})`);
    }
    const bestIndex = earlier.reduce((best, value, index) =>
      (lowerIsBetter ? value < earlier[best] : value > earlier[best]) ? index : best, 0);
    const bestValue = earlier[bestIndex];
    const bestShown = `${all.format(bestValue, units)}, ${shortDate(dated[bestIndex].start)}`;
    const delta = relative(bestValue);
    notable ||= Math.abs(delta) >= SAME_E1RM;
    const newBest = delta >= SAME_E1RM || (current.kind === "bodyweight" && delta > 0);
    if (newBest) clauses.push(`**New 3-month best** (previous ${bestShown})`);
    else if (Math.abs(delta) < SAME_E1RM) clauses.push(`about the same as your 3-month best (${bestShown})`);
    else clauses.push(`${number(Math.abs(delta) * 100)}% ${lowerIsBetter ? "slower than" : "below"} your 3-month best (${bestShown})`);

    const comparison = `${name}: ${describe(current, baseline, units, change)} in the previous session of this exercise; ${clauses.join("; ")}.`;
    const bestRepsUp = current.kind === "bodyweight" && baseline.kind === "bodyweight" && current.bestReps > baseline.bestReps;
    const achieved = newBest || (current.kind === "pace" ? change >= 0.025 : change >= SAME_E1RM || bestRepsUp);
    if (achieved) {
      report.achievements.push(comparison);
    }
    const differences = series.slice(0, -1).map((_, index) => gain(index, index + 1));
    const totalChange = gain(0, series.length - 1);
    const trend = series.length === TREND_SESSIONS && Math.abs(totalChange) >= 0.05
      && (differences.every((value) => value > 0) || differences.every((value) => value < 0));
    if (trend) {
      const directionLabel = current.kind === "pace"
        ? totalChange > 0 ? "faster" : "slower"
        : totalChange > 0 ? "improving" : "decreasing";
      report.patterns.push(`${name}: ${directionLabel} ${metric} across ${TREND_SESSIONS} sessions of this exercise (${percent(totalChange)} overall). Training context can explain changes; this is not a health assessment.`);
    } else if (change > -0.05 || bestRepsUp) {
      // Not an achievement or established trend: still surface the 3-month context when it differs from "about the same".
      if (!achieved && notable) report.patterns.push(comparison);
    } else {
      report.patterns.push(`${comparison} ${current.kind === "pace" ? "Slower" : "Lower"} this session, not an established trend; ordinary variation or planned training changes can explain it.`);
    }
  }
  if (!compared) {
    report.limitations.unshift("Not enough comparable history yet to assess progress or trends.");
  }
  if (compared && !report.achievements.length && !report.patterns.length) {
    report.patterns.push("No notable change in the comparable recorded metrics; that alone does not establish a plateau.");
  }
  report.limitations.push("Each exercise is compared with its most recent previous session, its 3-month average and its 3-month best, all within the last 90 days and even when set counts, loads and reps differ; the average is shown only with at least 3 previous sessions and trends need 4 sessions. Strength changes use an estimated 1RM (Epley formula, sets of 1-12 reps), which is only an estimate; bodyweight exercises use best-set reps; top set and total volume are shown as context. Warmup, dropset and failure sets are excluded, and workout-wide totals are not treated as performance changes.");
  report.limitations.push("Technique, effort, rest, bodyweight and training intent are not established by these metrics; changes are observations, not diagnoses or all-time records.");
  if (timed) {
    report.limitations.push("Distance/time comparisons use recorded activity only. Terrain, elevation, weather, heart rate and GPS are unavailable; activity titles do not prove a run.");
  }
  return report;
}

function markdownText(value: string) {
  return value.replace(/[\\`*_{}[\]<>#!|]/g, "\\$&");
}

export function renderWorkoutReport(report: WorkoutReport): string {
  const sections = [
    `## ${markdownText(label(report.title))}`,
    markdownText(report.summary),
    ...([
      ["What went well", report.achievements],
      ["Notable observations", report.patterns],
      ["Comparison limits", report.limitations],
    ] as const).flatMap(([heading, items]) => items.length
      ? [`### ${heading}\n${items.map((item) => `- ${markdownText(item)}`).join("\n")}`]
      : []),
  ];
  const rendered = sections.join("\n\n");
  return rendered.length <= 6000 ? rendered : `${rendered.slice(0, 5996)}\n...`;
}
