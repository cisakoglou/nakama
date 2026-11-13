import { z } from "zod";
import type { RecoveryContext } from "@/lib/recovery-context";

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
type Exercise = HevyWorkout["exercises"][number];
type WorkoutSet = Exercise["sets"][number];
type Units = "kg" | "lb";
type MetricKind = "reps" | "load" | "pace";
type Measurement = { kind: MetricKind; value: number; sets: WorkoutSet[] };

export type WorkoutReport = {
  workoutId: string;
  title: string;
  summary: string;
  achievements: string[];
  patterns: string[];
  limitations: string[];
  recovery?: RecoveryContext;
};

const HISTORY_DAYS = 90;
const MAX_COMPARISONS = 5;

function label(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 120);
}

function positive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function sameNumber(a: number | null | undefined, b: number | null | undefined) {
  return typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 0.000001;
}

function workingSets(exercise: Exercise) {
  const sets = exercise.sets.filter((set) => set.type === "normal");
  return [...sets].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

function measurements(exercise: Exercise): Measurement[] {
  const sets = workingSets(exercise);
  if (!sets.length) return [];
  if (sets.every((set) => positive(set.reps) && Number.isInteger(set.reps)
    && typeof set.weight_kg === "number" && set.weight_kg >= 0
    && !positive(set.distance_meters) && !positive(set.duration_seconds))) {
    const reps = sets.reduce((total, set) => total + set.reps!, 0);
    const result: Measurement[] = [{ kind: "reps", value: reps, sets }];
    if (sets.every((set) => positive(set.weight_kg))) {
      result.push({
        kind: "load",
        value: sets.reduce((total, set) => total + set.weight_kg!, 0) / sets.length,
        sets,
      });
    }
    return result;
  }
  if (sets.every((set) => positive(set.distance_meters) && positive(set.duration_seconds)
    && !positive(set.reps) && !positive(set.weight_kg))) {
    const distance = sets.reduce((total, set) => total + set.distance_meters!, 0);
    const duration = sets.reduce((total, set) => total + set.duration_seconds!, 0);
    return [{ kind: "pace", value: duration / distance * 1000, sets }];
  }
  return [];
}

function comparable(current: Measurement, previous: Measurement) {
  if (current.kind !== previous.kind || current.sets.length !== previous.sets.length) return false;
  return current.sets.every((set, index) => {
    const other = previous.sets[index];
    if (current.kind === "reps") return sameNumber(set.weight_kg, other.weight_kg);
    if (current.kind === "load") return sameNumber(set.reps, other.reps);
    return Math.abs(set.distance_meters! - other.distance_meters!) / other.distance_meters! <= 0.05;
  });
}

function number(value: number) {
  return Number(value.toFixed(1)).toString();
}

function valueLabel(measurement: Measurement, units: Units) {
  if (measurement.kind === "reps") return `${number(measurement.value)} total reps`;
  if (measurement.kind === "load") {
    const value = units === "lb" ? measurement.value * 2.2046226218 : measurement.value;
    return `${number(value)} ${units} average logged load`;
  }
  const seconds = Math.round(measurement.value);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} /km recorded pace`;
}

function context(measurement: Measurement) {
  const count = measurement.sets.length;
  const sets = `${count} matched normal ${count === 1 ? "set" : "sets"}`;
  if (measurement.kind === "reps") return `${sets} at the same logged loads`;
  if (measurement.kind === "load") return `${sets} with the same reps per set`;
  return `${sets} with distance within 5% per set`;
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
  recovery?: RecoveryContext,
): WorkoutReport {
  const normalSets = workout.exercises.reduce((total, exercise) => total + workingSets(exercise).length, 0);
  const report: WorkoutReport = {
    workoutId: workout.id,
    title: label(workout.title) || "Workout",
    summary: `Logged ${workout.exercises.length} ${workout.exercises.length === 1 ? "exercise" : "exercises"} and ${normalSets} normal working ${normalSets === 1 ? "set" : "sets"}.`,
    achievements: [],
    patterns: [],
    limitations: [],
    ...(recovery ? { recovery } : {}),
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
    const available = measurements(exercise);
    timed ||= available.some((entry) => entry.kind === "pace");
    const previousExercises = recent.flatMap((entry) => {
      const matches = entry.exercises.filter((candidate) =>
        candidate.exercise_template_id === exercise.exercise_template_id);
      return matches.length === 1 ? matches : [];
    });
    const candidates = available.map((current) => ({
      current,
      previous: previousExercises
        .flatMap((entry) => measurements(entry).filter((previous) => comparable(current, previous)))
        .slice(0, MAX_COMPARISONS),
    })).filter((candidate) => candidate.previous.length > 0);
    // Prefer the most recent comparable session, rather than a favorable older comparison.
    const latest = previousExercises.find((entry) => measurements(entry).some((previous) =>
      available.some((current) => comparable(current, previous))));
    const selected = candidates.find(({ current }) => latest && measurements(latest).some((previous) =>
      comparable(current, previous)));
    if (!selected) {
      report.limitations.push(available.length
        ? `${name}: not enough comparable history yet (same exercise and matched normal sets, last ${HISTORY_DAYS} days).`
        : `${name}: incomplete or unsupported normal-set metrics; no performance comparison made.`);
      continue;
    }
    compared++;
    const { current, previous } = selected;
    const baseline = previous[0];
    const direction = current.kind === "pace" ? -1 : 1;
    const change = (current.value - baseline.value) / baseline.value * direction;
    const comparison = `${name}: ${valueLabel(current, units)} vs ${valueLabel(baseline, units)} in the previous comparable session (${context(current)}).`;
    if (current.kind === "pace" ? change >= 0.025 : change > 0) {
      report.achievements.push(comparison);
    }
    const series = [current, ...previous.slice(0, 3)];
    const differences = series.slice(0, -1).map((entry, index) =>
      (entry.value - series[index + 1].value) * direction);
    const totalChange = (current.value - series[series.length - 1].value)
      / series[series.length - 1].value * direction;
    const trend = series.length === 4 && Math.abs(totalChange) >= 0.05
      && (differences.every((value) => value > 0) || differences.every((value) => value < 0));
    if (trend) {
      const directionLabel = current.kind === "pace"
        ? totalChange > 0 ? "faster" : "slower"
        : totalChange > 0 ? "improving" : "decreasing";
      report.patterns.push(`${name}: ${directionLabel} ${
        current.kind === "pace" ? "recorded pace" : current.kind === "reps" ? "reps at matched loads" : "logged load at matched reps"
      } across 4 comparable sessions (${context(current)}). ${
        valueLabel(series[3], units)
      } to ${valueLabel(current, units)}. Training context can explain changes; this is not a health assessment.`);
    } else if (change <= -0.05) {
      report.patterns.push(`${comparison} ${current.kind === "pace" ? "Slower" : "Lower"} this session, not an established trend; ordinary variation or planned training changes can explain it.`);
    }
  }
  if (!compared) {
    report.limitations.unshift("Not enough comparable history yet to assess progress or trends.");
  }
  if (compared && !report.achievements.length && !report.patterns.length) {
    report.patterns.push("No notable change in the comparable recorded metrics; that alone does not establish a plateau.");
  }
  report.limitations.push("Comparisons use only logged normal sets from up to 5 comparable sessions in the last 90 days; warmup, dropset and failure sets are excluded. Workout-wide totals are not treated as performance changes.");
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
      ...(report.recovery ? [["Recovery context", [
        ...report.recovery.observations, ...report.recovery.limitations,
      ]]] as const : []),
      ["Comparison limits", report.limitations],
    ] as const).flatMap(([heading, items]) => items.length
      ? [`### ${heading}\n${items.map((item) => `- ${markdownText(item)}`).join("\n")}`]
      : []),
  ];
  const rendered = sections.join("\n\n");
  return rendered.length <= 6000 ? rendered : `${rendered.slice(0, 5996)}\n...`;
}
