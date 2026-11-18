import { describe, expect, it } from "vitest";
import {
  buildRangeChart, hevyWindow, isRealDate, isoWeekMonday, rangeStart, sessionsFromHistory, weeklyBest, type Session,
} from "./exercise-series";

const set = (workout: string, start: string, type: string, weight: number | null, reps: number | null, template = "BENCH") => ({
  workout_id: workout, workout_title: "W", workout_start_time: start, workout_end_time: start, exercise_template_id: template,
  set_type: type, weight_kg: weight, reps, distance_meters: null, duration_seconds: null, rpe: null, custom_metric: null,
});
const session = (date: string, volume: number, maxWeight: number, kind: Session["kind"] = "strength", totalReps = 10): Session =>
  ({ date, start: `${date}T10:00:00Z`, kind, volume, maxWeight, totalReps });

describe("range math", () => {
  it("subtracts calendar months and clamps the day", () => {
    expect(rangeStart("2026-11-18", "3m")).toBe("2026-08-18");
    expect(rangeStart("2026-11-18", "1y")).toBe("2025-11-18");
    expect(rangeStart("2026-05-31", "3m")).toBe("2026-02-28");
    expect(rangeStart("2026-03-31", "9m")).toBe("2025-06-30");
  });
  it("pads the Hevy window by a day each side", () => {
    expect(hevyWindow("2026-08-18", "2026-11-18")).toEqual({ start_date: "2026-08-17T00:00:00Z", end_date: "2026-11-19T23:59:59Z" });
  });
  it("checks real dates", () => {
    expect(isRealDate("2026-02-28")).toBe(true);
    expect(isRealDate("2026-02-29")).toBe(false);
    expect(isRealDate("2026-2-1")).toBe(false);
  });
  it("finds the ISO week Monday, across month and year boundaries", () => {
    expect(isoWeekMonday("2026-11-18")).toBe("2026-11-16"); // Wednesday
    expect(isoWeekMonday("2026-11-16")).toBe("2026-11-16"); // Monday
    expect(isoWeekMonday("2026-11-22")).toBe("2026-11-16"); // Sunday belongs to the week before
    expect(isoWeekMonday("2026-11-23")).toBe("2026-11-23");
    expect(isoWeekMonday("2027-01-01")).toBe("2026-12-28"); // ISO week 53 of 2026
    expect(isoWeekMonday("2026-01-01")).toBe("2025-12-29"); // ISO week 1 of 2026 starts in 2025
  });
});

describe("sessionsFromHistory", () => {
  it("uses only normal sets, groups by workout, keeps the workout's own date and the range", () => {
    const entries = [
      set("a", "2026-11-18T07:00:00+02:00", "warmup", 40, 10),
      set("a", "2026-11-18T07:00:00+02:00", "normal", 60, 5),
      set("a", "2026-11-18T07:00:00+02:00", "normal", 62.5, 3),
      set("a", "2026-11-18T07:00:00+02:00", "dropset", 50, 8),
      set("a", "2026-11-18T07:00:00+02:00", "failure", 60, 2),
      // Late evening in a zone behind UTC: still its local date.
      set("b", "2026-11-10T23:30:00-05:00", "normal", 55, 5),
      set("c", "2026-08-17T10:00:00Z", "normal", 50, 5), // before the range start
      set("d", "2026-11-19T00:30:00+01:00", "normal", 70, 5), // after the end date
      set("e", "2026-11-12T10:00:00Z", "normal", 99, 5, "SQUAT"), // other template
      set("f", "2026-11-14T10:00:00Z", "warmup", 20, 10), // no working sets
      { junk: true },
    ];
    const sessions = sessionsFromHistory(entries, "BENCH", "2026-08-18", "2026-11-18");
    expect(sessions).toEqual([
      { date: "2026-11-10", start: "2026-11-10T23:30:00-05:00", kind: "strength", volume: 275, maxWeight: 55, totalReps: 5 },
      { date: "2026-11-18", start: "2026-11-18T07:00:00+02:00", kind: "strength", volume: 487.5, maxWeight: 62.5, totalReps: 8 },
    ]);
  });
  it("classifies bodyweight sessions", () => {
    const sessions = sessionsFromHistory([set("a", "2026-11-18T10:00:00Z", "normal", 0, 8), set("a", "2026-11-18T10:00:00Z", "normal", 0, 6)],
      "BENCH", "2026-08-18", "2026-11-18");
    expect(sessions[0]).toMatchObject({ kind: "bodyweight", totalReps: 14 });
  });
});

describe("weeklyBest", () => {
  it("keeps the best session of each ISO week, dated by Monday", () => {
    expect(weeklyBest([
      { date: "2026-12-28", value: 5 }, { date: "2027-01-03", value: 9 }, // same ISO week across the new year
      { date: "2027-01-04", value: 7 }, { date: "2027-01-06", value: 6 },
    ])).toEqual([{ date: "2026-12-28", value: 9 }, { date: "2027-01-04", value: 7 }]);
  });
});

describe("buildRangeChart", () => {
  const base = { end: "2026-11-18", templateId: "BENCH", title: "  Bench   Press ", units: "kg" as const };
  it("returns per-session points for 3m/6m and the v2 chart shape", () => {
    const result = buildRangeChart({ ...base, range: "6m", sessions: [session("2026-11-10", 1000, 60), session("2026-11-18", 1100.04, 62.5)] });
    expect(result).toEqual({
      range: "6m", granularity: "session",
      chart: { v: 2, exercise_template_id: "BENCH", title: "Bench Press", current_date: "2026-11-18", series: [
        { key: "volume", label: "Total volume", unit: "kg", points: [{ date: "2026-11-10", value: 1000 }, { date: "2026-11-18", value: 1100 }] },
        { key: "max_weight", label: "Max weight", unit: "kg", points: [{ date: "2026-11-10", value: 60 }, { date: "2026-11-18", value: 62.5 }] },
      ] },
    });
  });
  it("aggregates 9m/1y by ISO week, each series taking its own best", () => {
    const result = buildRangeChart({ ...base, range: "9m", sessions: [
      session("2026-11-16", 1200, 60), session("2026-11-18", 1000, 65), session("2026-11-23", 900, 55),
    ] })!;
    expect(result.granularity).toBe("week");
    expect(result.chart.series[0].points).toEqual([{ date: "2026-11-16", value: 1200 }, { date: "2026-11-23", value: 900 }]);
    expect(result.chart.series[1].points).toEqual([{ date: "2026-11-16", value: 65 }, { date: "2026-11-23", value: 55 }]);
  });
  it("switches to weekly when a session range has more than 60 sessions", () => {
    const sessions = Array.from({ length: 61 }, (_, i) => session(new Date(Date.UTC(2026, 5, 1) + i * 2 * 864e5).toISOString().slice(0, 10), 100 + i, 50));
    const result = buildRangeChart({ ...base, range: "6m", sessions })!;
    expect(result.granularity).toBe("week");
    expect(result.chart.series[0].points.length).toBeLessThanOrEqual(60);
  });
  it("converts to pounds", () => {
    const result = buildRangeChart({ ...base, units: "lb", range: "3m", sessions: [session("2026-11-18", 100, 60)] })!;
    expect(result.chart.series.map((s) => [s.unit, s.points[0].value])).toEqual([["lb", 220.5], ["lb", 132.3]]);
  });
  it("follows the latest session's kind and charts total reps for bodyweight", () => {
    const result = buildRangeChart({ ...base, range: "3m", sessions: [session("2026-11-10", 500, 20), session("2026-11-18", 0, 0, "bodyweight", 30)] })!;
    expect(result.chart.series).toEqual([{ key: "total_reps", label: "Total reps", unit: "reps", points: [{ date: "2026-11-18", value: 30 }] }]);
  });
  it("returns null without sessions", () => {
    expect(buildRangeChart({ ...base, range: "3m", sessions: [] })).toBeNull();
  });
});
