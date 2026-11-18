import { z } from "zod";

/** Pure helpers for the exercise-history range endpoint (CHART-CONTRACT-v2.md §2-3). */

export const RANGES = ["3m", "6m", "9m", "1y"] as const;
export type Range = (typeof RANGES)[number];
export type Units = "kg" | "lb";
export type Granularity = "session" | "week";

const RANGE_MONTHS: Record<Range, number> = { "3m": 3, "6m": 6, "9m": 9, "1y": 12 };
const WEEKLY_RANGES: ReadonlySet<Range> = new Set(["9m", "1y"]);
const KG_TO_LB = 2.2046226218;
export const MAX_POINTS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

export const templateIdSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

export function isRealDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const toDate = (day: string) => new Date(`${day}T00:00:00Z`);
const toDay = (date: Date) => date.toISOString().slice(0, 10);
export const addDays = (day: string, days: number) => toDay(new Date(toDate(day).getTime() + days * DAY_MS));

/** First day of the range: `end` minus the range's months (day clamped to the target month's length). */
export function rangeStart(end: string, range: Range) {
  const [y, m, d] = end.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 - RANGE_MONTHS[range], 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return toDay(target);
}

/** Monday (YYYY-MM-DD) of the ISO week containing `day`. */
export function isoWeekMonday(day: string) {
  const date = toDate(day);
  return addDays(day, -((date.getUTCDay() + 6) % 7));
}

/** Hevy query window: one day of slack each side, because Hevy filters by UTC instant and we by local workout date. */
export function hevyWindow(start: string, end: string) {
  return { start_date: `${addDays(start, -1)}T00:00:00Z`, end_date: `${addDays(end, 1)}T23:59:59Z` };
}

const entrySchema = z.object({
  workout_id: z.string().min(1),
  workout_start_time: z.string().datetime({ offset: true }),
  exercise_template_id: z.string().min(1),
  set_type: z.string().nullish(),
  weight_kg: z.number().finite().nullish(),
  reps: z.number().finite().nullish(),
  distance_meters: z.number().finite().nullish(),
  duration_seconds: z.number().finite().nullish(),
}).passthrough();
type Entry = z.infer<typeof entrySchema>;

export type Session = {
  /** Workout date as written in its own timestamp (no timezone conversion), like the report. */
  date: string;
  start: string;
  kind: "strength" | "bodyweight";
  /** kg */
  volume: number;
  /** kg */
  maxWeight: number;
  totalReps: number;
};

const positive = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/** Same classification as the report: only `normal` sets; every one must be a rep set with a load >= 0. */
function summarize(sets: Entry[]): Pick<Session, "kind" | "volume" | "maxWeight" | "totalReps"> | null {
  const normal = sets.filter((set) => set.set_type === "normal");
  if (!normal.length) return null;
  const repSets = normal.every((set) => positive(set.reps) && Number.isInteger(set.reps)
    && typeof set.weight_kg === "number" && set.weight_kg >= 0
    && !positive(set.distance_meters) && !positive(set.duration_seconds));
  if (!repSets) return null;
  const totalReps = normal.reduce((total, set) => total + set.reps!, 0);
  if (normal.every((set) => set.weight_kg === 0)) return { kind: "bodyweight", volume: 0, maxWeight: 0, totalReps };
  return {
    kind: "strength",
    volume: normal.reduce((total, set) => total + set.weight_kg! * set.reps!, 0),
    maxWeight: Math.max(...normal.map((set) => set.weight_kg!)),
    totalReps,
  };
}

/** Groups Hevy exercise_history entries (one per set) into per-workout sessions within [start, end], oldest first. */
export function sessionsFromHistory(entries: unknown[], templateId: string, start: string, end: string): Session[] {
  const byWorkout = new Map<string, Entry[]>();
  for (const raw of entries) {
    const parsed = entrySchema.safeParse(raw);
    if (!parsed.success || parsed.data.exercise_template_id !== templateId) continue;
    const list = byWorkout.get(parsed.data.workout_id) ?? [];
    list.push(parsed.data);
    byWorkout.set(parsed.data.workout_id, list);
  }
  const sessions: Session[] = [];
  for (const sets of byWorkout.values()) {
    const date = sets[0].workout_start_time.slice(0, 10);
    if (date < start || date > end) continue;
    const summary = summarize(sets);
    if (summary) sessions.push({ date, start: sets[0].workout_start_time, ...summary });
  }
  return sessions.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.date.localeCompare(b.date));
}

type Point = { date: string; value: number };
export type RangeSeries = {
  key: "volume" | "max_weight" | "total_reps";
  label: string;
  unit: "kg" | "lb" | "reps";
  points: Point[];
};
export type RangeChart = {
  v: 2;
  exercise_template_id: string;
  title: string;
  current_date: string;
  series: RangeSeries[];
};

const round1 = (value: number) => Number(value.toFixed(1));

/** Best session per ISO week (max of each value independently), dated by the week's Monday. */
export function weeklyBest(points: Point[]): Point[] {
  const weeks = new Map<string, number>();
  for (const { date, value } of points) {
    const monday = isoWeekMonday(date);
    weeks.set(monday, Math.max(weeks.get(monday) ?? -Infinity, value));
  }
  return [...weeks].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));
}

/**
 * Builds the range chart. The chart's kind (weighted vs bodyweight) follows the most recent session; sessions
 * of the other kind are left out, like the report. Returns null when there is nothing to chart.
 */
export function buildRangeChart(input: {
  sessions: Session[]; range: Range; end: string; templateId: string; title: string; units: Units;
}): { range: Range; granularity: Granularity; chart: RangeChart } | null {
  const { range, end, templateId, units } = input;
  const latest = input.sessions.at(-1);
  if (!latest) return null;
  const sessions = input.sessions.filter((session) => session.kind === latest.kind);
  const granularity: Granularity = WEEKLY_RANGES.has(range) || sessions.length > MAX_POINTS ? "week" : "session";
  const convert = (kg: number) => round1(units === "lb" ? kg * KG_TO_LB : kg);
  const shape = (points: Point[]) => (granularity === "week" ? weeklyBest(points) : points).slice(-MAX_POINTS);
  const series: RangeSeries[] = latest.kind === "bodyweight"
    ? [{ key: "total_reps", label: "Total reps", unit: "reps",
      points: shape(sessions.map((s) => ({ date: s.date, value: round1(s.totalReps) }))) }]
    : [
      { key: "volume", label: "Total volume", unit: units,
        points: shape(sessions.map((s) => ({ date: s.date, value: convert(s.volume) }))) },
      { key: "max_weight", label: "Max weight", unit: units,
        points: shape(sessions.map((s) => ({ date: s.date, value: convert(s.maxWeight) }))) },
    ];
  const title = input.title.replace(/\s+/g, " ").trim().slice(0, 80) || "Exercise";
  return { range, granularity, chart: { v: 2, exercise_template_id: templateId, title, current_date: end, series } };
}
