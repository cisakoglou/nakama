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

export type ChartSeries = {
  key: "volume" | "max_weight" | "total_reps";
  label: string;
  unit: "kg" | "lb" | "reps";
  points: { date: string; value: number }[];
};

/** Payload of a `nakama-chart` block (see CHART-CONTRACT.md). */
export type ChartData = { v: 2; exercise_template_id: string; title: string; current_date: string; series: ChartSeries[] };

export type ExerciseReport = {
  name: string;
  /** Plain-text facts for this exercise, without the exercise name prefix. */
  lines: string[];
  chart?: ChartData;
};

export type WorkoutReport = {
  workoutId: string;
  title: string;
  summary: string;
  exercises: ExerciseReport[];
  /** All-time PR lines (also shown first under their exercise). */
  prs: string[];
  achievements: string[];
  patterns: string[];
  /** Per-exercise facts the reader needs (e.g. first time logged); not generic boilerplate. */
  limitations: string[];
};

const MAX_CHARTS = 8;
const MAX_POINTS = 60;
const MAX_RENDERED_CHARS = 20000;

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

function prDate(iso: string, currentIso: string) {
  const year = /^(\d{4})/.exec(iso)?.[1];
  const base = shortDate(iso);
  return year && year !== /^(\d{4})/.exec(currentIso)?.[1] ? `${base} ${year}` : base;
}

/** Every earlier session of the exercise (any age), most recent first, for all-time PR detection. */
function allPreviousSessions(workout: HevyWorkout, history: HevyWorkout[], templateId: string) {
  const start = Date.parse(workout.start_time);
  const seen = new Set([workout.id]);
  return [...history]
    .filter((entry) => Date.parse(entry.end_time) < start && Date.parse(entry.end_time) >= Date.parse(entry.start_time))
    .sort((a, b) => Date.parse(b.end_time) - Date.parse(a.end_time))
    .filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    })
    .flatMap((entry) => {
      const matches = entry.exercises.filter((candidate) => candidate.exercise_template_id === templateId);
      const summary = matches.length === 1 ? summarize(matches[0]) : null;
      return summary ? [{ summary, start: entry.start_time }] : [];
    });
}

/** All-time PR lines: only when this session strictly beats every earlier session of the exercise. */
function prLines(current: Summary, earlier: { summary: Summary; start: string }[], workout: HevyWorkout, units: Units) {
  if (current.kind === "pace") return [];
  const same = earlier.filter((entry) => entry.summary.kind === current.kind);
  if (!same.length) return [];
  const show = (kg: number) => `${number(units === "lb" ? kg * KG_TO_LB : kg)} ${units}`;
  const round = (kg: number) => Number((units === "lb" ? kg * KG_TO_LB : kg).toFixed(1));
  const best = (pick: (summary: Summary) => number | null) => {
    let found: { value: number; start: string } | null = null;
    for (const entry of same) {
      const value = pick(entry.summary);
      if (value !== null && (!found || value > found.value)) found = { value, start: entry.start };
    }
    return found;
  };
  const lines: string[] = [];
  if (current.kind === "bodyweight") {
    const previous = best((summary) => (summary as typeof current).bestReps);
    if (previous && current.bestReps > previous.value) {
      lines.push(`🏆 New PR: ${current.bestReps} reps in a set (previous best ${previous.value}, ${prDate(previous.start, workout.start_time)})`);
    }
    return lines;
  }
  const weight = best((summary) => (summary as typeof current).topWeight);
  if (weight && round(current.topWeight) > round(weight.value)) {
    lines.push(`🏆 New PR: heaviest weight ${show(current.topWeight)} (previous best ${show(weight.value)}, ${prDate(weight.start, workout.start_time)})`);
  }
  const e1rm = best((summary) => (summary as typeof current).e1rm);
  if (current.e1rm !== null && e1rm && round(current.e1rm) > round(e1rm.value)) {
    lines.unshift(`🏆 New PR: estimated 1RM ${show(current.e1rm)} (previous best ${show(e1rm.value)}, ${prDate(e1rm.start, workout.start_time)})`);
  }
  return lines;
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

function isoDay(iso: string) {
  return /^\d{4}-\d{2}-\d{2}/.exec(iso)?.[0] ?? null;
}

function round1(value: number) {
  return Number(value.toFixed(1));
}

/** 90-day per-session series (oldest first, current workout last); null when it cannot or should not be charted. */
function buildChart(
  name: string,
  templateId: string,
  workout: HevyWorkout,
  current: Summary,
  previousSessions: { exercise: Exercise; start: string }[],
  units: Units,
): ChartData | null {
  if (current.kind === "pace") return null;
  const sessions: { date: string; summary: Summary }[] = [];
  for (const session of [...previousSessions].reverse()) {
    const summary = summarize(session.exercise);
    const date = isoDay(session.start);
    if (summary && date && summary.kind === current.kind) sessions.push({ date, summary });
  }
  const currentDate = isoDay(workout.start_time);
  if (!currentDate) return null;
  sessions.push({ date: currentDate, summary: current });
  const recent = sessions.slice(-MAX_POINTS);
  if (recent.length < 2) return null;
  const convert = (kg: number) => round1(units === "lb" ? kg * KG_TO_LB : kg);
  const series: ChartSeries[] = current.kind === "bodyweight"
    ? [{ key: "total_reps", label: "Total reps", unit: "reps",
      points: recent.map(({ date, summary }) => ({ date, value: round1((summary as typeof current).totalReps) })) }]
    : [
      { key: "volume", label: "Total volume", unit: units,
        points: recent.map(({ date, summary }) => ({ date, value: convert((summary as typeof current).volume) })) },
      { key: "max_weight", label: "Max weight", unit: units,
        points: recent.map(({ date, summary }) => ({ date, value: convert((summary as typeof current).topWeight) })) },
    ];
  return { v: 2, exercise_template_id: templateId, title: name.slice(0, 80), current_date: currentDate, series };
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
    exercises: [],
    prs: [],
    achievements: [],
    patterns: [],
    limitations: [],
  };
  const recent = recentHistory(workout, history);
  const templateIds = workout.exercises.map((exercise) => exercise.exercise_template_id);

  let charts = 0;
  for (const exercise of workout.exercises) {
    const name = label(exercise.title) || "Exercise";
    const entry: ExerciseReport = { name, lines: [] };
    report.exercises.push(entry);
    const add = (kind: "prs" | "achievements" | "patterns" | "limitations", text: string) => {
      entry.lines.push(text);
      report[kind].push(`${name}: ${text}`);
    };
    if (templateIds.filter((id) => id === exercise.exercise_template_id).length !== 1) {
      add("limitations", "Repeated exercise entries cannot be matched reliably.");
      continue;
    }
    const current = summarize(exercise);
    if (!current) {
      add("limitations", "Incomplete or unsupported normal-set metrics; no performance comparison made.");
      continue;
    }
    for (const line of prLines(current, allPreviousSessions(workout, history, exercise.exercise_template_id), workout, units)) {
      add("prs", line);
    }
    const previousSessions = recent.flatMap((entry) => {
      const matches = entry.exercises.filter((candidate) =>
        candidate.exercise_template_id === exercise.exercise_template_id);
      return matches.length === 1 ? [{ exercise: matches[0], start: entry.start_time }] : [];
    });
    if (charts < MAX_CHARTS) {
      const chart = buildChart(name, exercise.exercise_template_id, workout, current, previousSessions, units);
      if (chart) { entry.chart = chart; charts++; }
    }
    if (!previousSessions.length) {
      add("limitations", `First time logging this exercise in the last ${HISTORY_DAYS} days.`);
      continue;
    }
    const dated = previousSessions
      .map((session) => ({ summary: summarize(session.exercise), start: session.start }))
      .filter((entry): entry is { summary: Summary; start: string } => entry.summary !== null && comparable(current, entry.summary));
    if (!dated.length) {
      add("limitations", `Earlier sessions in the last ${HISTORY_DAYS} days have no comparable normal-set metrics.`);
      continue;
    }
    const previous = dated.map((entry) => entry.summary);
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
    const comparison = `${describe(current, baseline, units, change)} in the previous session of this exercise${clauses.length ? `; ${clauses.join("; ")}` : ""}.`;
    const bestRepsUp = current.kind === "bodyweight" && baseline.kind === "bodyweight" && current.bestReps > baseline.bestReps;
    const achieved = current.kind === "pace" ? change >= 0.025 : change >= SAME_E1RM || bestRepsUp;
    if (achieved) add("achievements", comparison);
    const differences = series.slice(0, -1).map((_, index) => gain(index, index + 1));
    const totalChange = gain(0, series.length - 1);
    const trend = series.length === TREND_SESSIONS && Math.abs(totalChange) >= 0.05
      && (differences.every((value) => value > 0) || differences.every((value) => value < 0));
    if (trend) {
      const directionLabel = current.kind === "pace"
        ? totalChange > 0 ? "faster" : "slower"
        : totalChange > 0 ? "improving" : "decreasing";
      add("patterns", `${directionLabel[0].toUpperCase()}${directionLabel.slice(1)} ${metric} across ${TREND_SESSIONS} sessions of this exercise (${percent(totalChange)} overall).`);
    } else if (change > -0.05 || bestRepsUp) {
      // Not an achievement or established trend: still surface the 3-month context when it differs from "about the same".
      if (!achieved && notable) add("patterns", comparison);
      else if (!achieved) add("patterns", "No notable change in the comparable recorded metrics.");
    } else {
      add("patterns", `${comparison} ${current.kind === "pace" ? "Slower" : "Lower"} this session, not an established trend.`);
    }
  }
  return report;
}

function markdownText(value: string) {
  return value.replace(/[\\`*_{}[\]<>#!|]/g, "\\$&");
}

function capitalize(text: string) {
  return text.replace(/^[a-z]/, (letter) => letter.toUpperCase());
}

function chartBlock(chart: ChartData) {
  return `\`\`\`nakama-chart\n${JSON.stringify(chart)}\n\`\`\``;
}

/**
 * One section per exercise: heading, fact bullets, then its chart block. When the report is too long
 * whole trailing charts are dropped (never cut mid-block) before any text is truncated.
 */
export function renderWorkoutReport(report: WorkoutReport): string {
  const head = [`## ${markdownText(label(report.title))}`, markdownText(report.summary)];
  const build = (maxCharts: number) => {
    let charts = 0;
    const sections = report.exercises.flatMap((exercise) => {
      const chart = exercise.chart && charts < maxCharts ? (charts++, exercise.chart) : undefined;
      if (!exercise.lines.length && !chart) return [];
      return [[
        `### ${markdownText(label(exercise.name))}`,
        ...(exercise.lines.length ? [exercise.lines.map((line) => `- ${capitalize(markdownText(line))}`).join("\n")] : []),
        ...(chart ? [chartBlock(chart)] : []),
      ].join("\n\n")];
    });
    return [...head, ...sections].join("\n\n");
  };
  let charts = report.exercises.filter((exercise) => exercise.chart).length;
  let rendered = build(charts);
  while (rendered.length > MAX_RENDERED_CHARS && charts > 0) rendered = build(--charts);
  return rendered.length <= MAX_RENDERED_CHARS ? rendered : `${rendered.slice(0, MAX_RENDERED_CHARS - 4)}\n...`;
}
