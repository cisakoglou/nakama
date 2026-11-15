import { describe, expect, it } from "vitest";
import {
  generateWorkoutReport, hevyWorkoutSchema, historyFromExerciseHistory, parseHistoryWorkout, renderWorkoutReport, type HevyWorkout,
} from "./workout-report";

type Exercise = HevyWorkout["exercises"][number];
type WorkoutSet = Exercise["sets"][number];

function strength(reps: number[], weight = 50, id = "bench"): Exercise {
  return {
    title: "Bench press",
    exercise_template_id: id,
    sets: reps.map((count, index) => ({ index, type: "normal", weight_kg: weight, reps: count })),
  };
}

function cardio(seconds: number, distance = 5000): Exercise {
  return {
    title: "Recorded activity",
    exercise_template_id: "distance-time",
    sets: [{ index: 0, type: "normal", distance_meters: distance, duration_seconds: seconds }],
  };
}

function workout(day: number, exercises: Exercise[], id = `workout-${day}`): HevyWorkout {
  return {
    id,
    title: "Training",
    start_time: `2026-11-${String(day).padStart(2, "0")}T10:00:00Z`,
    end_time: `2026-11-${String(day).padStart(2, "0")}T11:00:00Z`,
    exercises,
  };
}

describe("workout report comparisons", () => {
  it("accepts official nullable/optional fields and strips extra API properties", () => {
    const result = hevyWorkoutSchema.parse({
      ...workout(10, [strength([8])]),
      routine_id: null,
      description: null,
      extra: "unused",
      exercises: [{
        ...strength([8]), notes: null, superset_id: null, extra: "unused",
        sets: [{ type: "normal", weight_kg: null, reps: null, duration_seconds: null, extra: "unused" }],
      }],
    });
    expect(result).not.toHaveProperty("extra");
    expect(result.exercises[0].sets[0]).not.toHaveProperty("extra");
    expect(generateWorkoutReport(result, []).limitations.join(" ")).toContain("incomplete");
    expect(hevyWorkoutSchema.safeParse({ ...result, start_time: "not a date" }).success).toBe(false);
    expect(hevyWorkoutSchema.safeParse({
      ...result, exercises: [{ ...strength([8]), sets: [{ type: "normal", reps: Infinity }] }],
    }).success).toBe(false);
  });

  it("reports logged work with no fabricated progress when history is empty or data is sparse", () => {
    const current = workout(10, [{
      title: "Unknown exercise", exercise_template_id: "unknown", sets: [{ type: "normal" }],
    }]);
    const report = generateWorkoutReport(current, []);
    expect(report.summary).toContain("1 normal working set.");
    expect(report.achievements).toEqual([]);
    expect(report.patterns).toEqual([]);
    expect(report.limitations[0]).toContain("Not enough comparable history");
    expect(generateWorkoutReport(workout(10, []), []).summary).toContain("0 exercises");
  });

  it("compares progressive overload with different weights and reps (the common case)", () => {
    const week1 = { ...strength([]), sets: [60, 60, 60].map((w, i): WorkoutSet => ({ index: i, type: "normal", weight_kg: w, reps: [8, 8, 7][i] })) };
    const week2 = { ...strength([]), sets: [62.5, 62.5, 62.5].map((w, i): WorkoutSet => ({ index: i, type: "normal", weight_kg: w, reps: [8, 7, 6][i] })) };
    const report = generateWorkoutReport(workout(10, [week2]), [workout(3, [week1])]);
    expect(report.achievements).toHaveLength(1);
    expect(report.achievements[0]).toContain("estimated 1RM 79.2 kg vs 76 kg (+4.2%)");
    expect(report.achievements[0]).toContain("top set 62.5 kg x 8 vs 60 kg x 8");
    expect(report.achievements[0]).toContain("total volume 1312.5 kg vs 1380 kg");
    expect(report.limitations.join(" ")).toContain("estimate");
    expect(report.limitations.join(" ")).not.toContain("Not enough comparable history");
    expect(renderWorkoutReport(report)).toContain("What went well");
  });

  it("finds gains while excluding warmup and non-normal sets", () => {
    const exercise = strength([9, 9]);
    exercise.sets.push(
      { type: "warmup", weight_kg: 200, reps: 10 },
      { type: "dropset", weight_kg: 200, reps: 10 },
      { type: "failure", weight_kg: 200, reps: 10 },
    );
    const report = generateWorkoutReport(workout(10, [exercise]), [workout(9, [strength([8, 8])])]);
    expect(report.achievements).toHaveLength(1);
    expect(report.achievements[0]).toContain("estimated 1RM 65 kg vs 63.3 kg");
    expect(report.achievements[0]).toContain("top set 50 kg x 9");
    expect(report.summary).toContain("2 normal working sets");
  });

  it("displays lb units", () => {
    const report = generateWorkoutReport(
      workout(10, [strength([8, 8], 55)]), [workout(9, [strength([8, 8], 50)])], "lb",
    );
    expect(report.achievements[0]).toContain("estimated 1RM 153.6 lb vs 139.6 lb");
    expect(report.achievements[0]).toContain("top set 121.3 lb x 8 vs 110.2 lb x 8");
  });

  it("compares different set counts", () => {
    const report = generateWorkoutReport(workout(10, [strength([10, 10, 10], 50)]), [workout(9, [strength([8], 50)])]);
    expect(report.achievements[0]).toContain("estimated 1RM 66.7 kg vs 63.3 kg");
    expect(report.achievements[0]).toContain("total volume 1500 kg vs 400 kg");
  });

  it("treats a change under 2% as about the same, with no achievement or warning", () => {
    const report = generateWorkoutReport(workout(10, [strength([8], 50.5)]), [workout(9, [strength([8], 50)])]);
    expect(report.achievements).toEqual([]);
    expect(report.patterns[0]).toContain("No notable change");
  });

  it("compares bodyweight exercises by best set and total reps", () => {
    const report = generateWorkoutReport(workout(10, [strength([12, 10], 0)]), [workout(9, [strength([10, 10, 8], 0)])]);
    expect(report.achievements[0]).toContain("22 total reps vs 28");
    expect(report.achievements[0]).toContain("best set 12 vs 10 reps");
    const same = generateWorkoutReport(workout(10, [strength([12], 0)]), [workout(9, [strength([10], 0)])]);
    expect(same.achievements[0]).toContain("12 total reps vs 10");
    const missing = { ...strength([10]), sets: [{ type: "normal" as const, reps: 10, weight_kg: null }] };
    const unsupported = generateWorkoutReport(workout(10, [strength([12], 0)]), [workout(9, [missing])]);
    expect(unsupported.achievements).toEqual([]);
    expect(unsupported.limitations.join(" ")).toContain("no comparable normal-set metrics");
  });

  it("says first time logging only when the exercise has no session in 90 days", () => {
    const report = generateWorkoutReport(workout(10, [strength([10, 10])]), [workout(9, [strength([8, 8], 50, "different")])]);
    expect(report.achievements).toEqual([]);
    expect(report.patterns).toEqual([]);
    expect(report.limitations[0]).toContain("Not enough comparable history");
    expect(report.limitations.join(" ")).toContain("first time logging this exercise in the last 90 days");
  });

  it("does not infer gains from a different exercise", () => {
    const report = generateWorkoutReport(
      workout(10, [strength([5, 5], 70), strength([20], 10, "new-exercise")]),
      [workout(9, [strength([10, 10], 50, "other")])],
    );
    expect(report.achievements).toEqual([]);
    expect(report.patterns).toEqual([]);
  });

  it("uses the nearest previous session rather than a more favorable older metric", () => {
    const report = generateWorkoutReport(workout(10, [strength([8], 60)]), [
      workout(9, [strength([8], 65)]),
      workout(8, [strength([6], 60)]),
    ]);
    expect(report.achievements).toEqual([]);
    expect(report.patterns[0]).toContain("estimated 1RM 76 kg vs 82.3 kg");
  });

  it("distinguishes a one-session drop from a consistent 4-session trend", () => {
    const current = workout(10, [strength([6, 6])]);
    const one = generateWorkoutReport(current, [workout(9, [strength([8, 8])])]);
    expect(one.patterns[0]).toContain("not an established trend");
    const trend = generateWorkoutReport(current, [
      workout(7, [strength([9, 9])]), workout(9, [strength([7, 7])]), workout(8, [strength([8, 8])]),
    ]);
    expect(trend.patterns[0]).toContain("decreasing estimated 1RM across 4 sessions");
    expect(trend.patterns[0]).not.toMatch(/injur|overtrain|danger/i);
  });

  it("identifies positive trends only with three prior consistent sessions", () => {
    const current = workout(10, [strength([10, 10])]);
    const history = [workout(9, [strength([9, 9])]), workout(8, [strength([8, 8])]), workout(7, [strength([7, 7])])];
    expect(generateWorkoutReport(current, history).patterns[0]).toContain("improving estimated 1RM");
    expect(generateWorkoutReport(current, history.slice(0, 2)).patterns.join(" ")).not.toContain("across 4");
    history[1] = workout(8, [strength([10, 10])]);
    expect(generateWorkoutReport(current, history).patterns.join(" ")).not.toContain("across 4");
  });

  it("ignores duplicate IDs, current/future/overlapping sessions and old history", () => {
    const current = workout(10, [strength([10])]);
    const old = {
      ...workout(1, [strength([5])], "old"),
      start_time: "2026-01-01T10:00:00Z", end_time: "2026-01-01T11:00:00Z",
    };
    const previous = workout(9, [strength([9])]);
    const report = generateWorkoutReport(current, [
      current, previous, previous, previous, workout(11, [strength([8])]),
      { ...workout(10, [strength([8])], "overlap"), end_time: "2026-11-10T10:30:00Z" },
      old,
    ]);
    expect(report.achievements[0]).toContain("estimated 1RM 66.7 kg vs 65 kg");
    expect(report.patterns.join(" ")).not.toContain("across 4");
    const oldOnly = generateWorkoutReport(current, [old]);
    expect(oldOnly.achievements).toEqual([]);
    expect(oldOnly.limitations.join(" ")).toContain("first time logging");
  });

  it("does not match repeated exercise entries", () => {
    const report = generateWorkoutReport(
      workout(10, [strength([10]), strength([10])]), [workout(9, [strength([8])])],
    );
    expect(report.achievements).toEqual([]);
    expect(report.limitations.join(" ")).toContain("repeated exercise entries");
  });

  it("still counts a history workout containing an unknown set type", () => {
    const raw = {
      ...workout(9, [strength([8, 8])]),
      exercises: [{ ...strength([8, 8]), sets: [
        { index: 0, type: "normal", weight_kg: 50, reps: 8 },
        { index: 1, type: "some_new_type", weight_kg: 50, reps: 8 },
        { index: 2, type: "normal", weight_kg: 50, reps: Infinity },
      ] }],
    };
    expect(hevyWorkoutSchema.safeParse(raw).success).toBe(false);
    const parsed = parseHistoryWorkout(raw);
    expect(parsed?.exercises[0].sets).toHaveLength(1);
    const report = generateWorkoutReport(workout(10, [strength([10, 10])]), [parsed!]);
    expect(report.achievements[0]).toContain("estimated 1RM");
    expect(parseHistoryWorkout({ id: "x" })).toBeNull();
  });

  it("compares recorded pace only for matching exercise and distance/set layouts", () => {
    const report = generateWorkoutReport(workout(10, [cardio(1500)]), [workout(9, [cardio(1650)])]);
    expect(report.achievements[0]).toContain("5:00 /km recorded pace vs 5:30 /km");
    expect(report.limitations.join(" ")).toContain("activity titles do not prove a run");
    for (const previous of [
      cardio(3000, 10000),
      { ...cardio(1650), exercise_template_id: "different-activity" },
      { ...cardio(1650), sets: [{ type: "normal" as const, distance_meters: 5000 }] },
      { ...cardio(1650), sets: [{ type: "normal" as const, distance_meters: 0, duration_seconds: 10 }] },
    ]) {
      expect(generateWorkoutReport(workout(10, [cardio(1500)]), [workout(9, [previous])]).achievements).toEqual([]);
    }
  });

  it("treats slower recorded pace as a decrease, not a medical warning", () => {
    const report = generateWorkoutReport(workout(10, [cardio(1800)]), [
      workout(9, [cardio(1700)]), workout(8, [cardio(1600)]), workout(7, [cardio(1500)]),
    ]);
    expect(report.patterns[0]).toContain("slower recorded pace across 4");
    expect(report.achievements).toEqual([]);
  });

  it("compares intervals and single efforts by total distance and time when set counts differ", () => {
    const intervals = (distances: number[]): Exercise => ({
      ...cardio(0),
      sets: distances.map((distance_meters, index) => ({
        index, type: "normal", distance_meters, duration_seconds: distance_meters * 0.3,
      })),
    });
    const report = generateWorkoutReport(workout(10, [cardio(1400)]), [workout(9, [intervals([2500, 2500])])]);
    expect(report.achievements[0]).toContain("1 set vs 2");
    const far = generateWorkoutReport(workout(10, [intervals([1000, 4000])]), [workout(9, [cardio(1500, 10000)])]);
    expect(far.achievements).toEqual([]);
  });

  it("avoids treating small variation or unchanged metrics as negative patterns or a plateau", () => {
    const report = generateWorkoutReport(workout(10, [cardio(1510)]), [workout(9, [cardio(1500)])]);
    expect(report.achievements).toEqual([]);
    expect(report.patterns[0]).toContain("No notable change");
    const unchanged = generateWorkoutReport(workout(10, [strength([8])]), [workout(9, [strength([8])])]);
    expect(unchanged.patterns[0]).toContain("does not establish a plateau");
  });

  it("renders bounded Markdown and escapes untrusted workout/exercise text", () => {
    const report = generateWorkoutReport(
      { ...workout(10, [strength([10])]), title: "[click](https://bad.example) <script>\n# injected" },
      [workout(9, [strength([8])])],
    );
    const rendered = renderWorkoutReport(report);
    expect(rendered).toContain("### What went well");
    expect(rendered).not.toContain("[click]");
    expect(rendered).not.toContain("<script>");
    expect(rendered).not.toContain("\n# injected");
    report.limitations.push("x".repeat(10000));
    expect(renderWorkoutReport(report).length).toBeLessThanOrEqual(6000);
  });
});

describe("3-month average and best", () => {
  const bench = (weight: number) => strength([5, 5, 5], weight);

  it("shows the average only with at least 3 previous sessions", () => {
    const two = generateWorkoutReport(workout(10, [bench(60)]), [workout(9, [bench(55)]), workout(8, [bench(50)])]);
    expect(two.achievements.join(" ")).not.toContain("3-month average");
    const three = generateWorkoutReport(workout(10, [bench(60)]), [workout(9, [bench(55)]), workout(8, [bench(50)]), workout(7, [bench(45)])]);
    expect(three.achievements[0]).toContain("+20% vs your 3-month average (58.3 kg)");
  });

  it("calls out a new 3-month best with the previous best and its date", () => {
    const report = generateWorkoutReport(workout(10, [bench(60)]), [workout(9, [bench(50)]), workout(5, [bench(55)]), workout(2, [bench(40)])]);
    expect(report.achievements[0]).toContain("**New 3-month best** (previous 64.2 kg, 5 Nov)");
  });

  it("reports how far below the 3-month best, without calling it an achievement", () => {
    const report = generateWorkoutReport(workout(10, [bench(50)]), [workout(9, [bench(52)]), workout(5, [bench(60)])]);
    const text = [...report.achievements, ...report.patterns].join(" ");
    expect(text).toContain("16.7% below your 3-month best (70 kg, 5 Nov)");
    expect(report.achievements).toEqual([]);
  });

  it("treats a value within 2% of the best as about the same", () => {
    const report = generateWorkoutReport(workout(10, [bench(60)]), [workout(9, [bench(59.5)])]);
    expect(report.patterns[0]).toContain("No notable change");
    expect(report.achievements).toEqual([]);
  });

  it("uses best-set reps for bodyweight exercises", () => {
    const report = generateWorkoutReport(workout(10, [strength([12], 0)]), [workout(9, [strength([10, 10], 0)]), workout(5, [strength([8], 0)]), workout(2, [strength([9], 0)])]);
    expect(report.achievements[0]).toContain("+33.3% vs your 3-month average (9 reps)");
    expect(report.achievements[0]).toContain("**New 3-month best** (previous 10 reps, 9 Nov)");
  });

  it("uses recorded pace with faster being better", () => {
    const report = generateWorkoutReport(workout(10, [cardio(1500)]), [workout(9, [cardio(1550)]), workout(5, [cardio(1600)]), workout(2, [cardio(1650)])]);
    expect(report.achievements[0]).toContain("faster than your 3-month average (5:20 /km recorded pace)");
    expect(report.achievements[0]).toContain("**New 3-month best** (previous 5:10 /km recorded pace, 9 Nov)");
    const slower = generateWorkoutReport(workout(10, [cardio(1700)]), [workout(9, [cardio(1550)])]);
    expect(slower.patterns.join(" ")).toContain("slower than your 3-month best (5:10 /km recorded pace, 9 Nov)");
  });

  it("makes no history claims for a first-time exercise", () => {
    const report = generateWorkoutReport(workout(10, [bench(60)]), [workout(9, [strength([5], 50, "squat")])]);
    expect(report.achievements).toEqual([]);
    expect(report.limitations.join(" ")).toContain("first time logging this exercise");
  });

  it("displays averages and bests in lb", () => {
    const report = generateWorkoutReport(workout(10, [bench(60)]), [workout(9, [bench(50)]), workout(8, [bench(50)]), workout(7, [bench(50)])], "lb");
    expect(report.achievements[0]).toContain("vs your 3-month average (128.6 lb)");
    expect(report.achievements[0]).toContain("previous 128.6 lb, 9 Nov");
  });

  it("stays within the render cap and documents the 90-day window", () => {
    const many = Array.from({ length: 20 }, (_, i) => strength([5, 5, 5], 60 + i, `ex${i}`));
    const past = Array.from({ length: 6 }, (_, d) => workout(d + 1, many.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s, weight_kg: 40 })) }))));
    const rendered = renderWorkoutReport(generateWorkoutReport(workout(10, many), past));
    expect(rendered.length).toBeLessThanOrEqual(6000);
    const limits = renderWorkoutReport(generateWorkoutReport(workout(10, [bench(60)]), [workout(9, [bench(50)])]));
    expect(limits).toContain("last 90 days");
    expect(limits).toContain("at least 3 previous sessions");
  });

  it("adapts exercise_history sets into sessions, dropping bad sets and the current workout", () => {
    const entry = (id: string, day: number, extra: object = {}) => ({
      workout_id: id, workout_title: "T", workout_start_time: `2026-11-0${day}T10:00:00Z`,
      workout_end_time: `2026-11-0${day}T11:00:00Z`, exercise_template_id: "bench", weight_kg: 50, reps: 5, set_type: "normal", ...extra,
    });
    const sessions = historyFromExerciseHistory([{ templateId: "bench", title: "Bench", entries: [
      entry("a", 1), entry("a", 1), entry("a", 1, { reps: "x" }), entry("a", 1, { set_type: "bogus" }), entry("cur", 2), null, entry("b", 3),
    ] }], "cur");
    expect(sessions.map((w) => [w.id, w.exercises[0].sets.length])).toEqual([["a", 2], ["b", 1]]);
  });
});
