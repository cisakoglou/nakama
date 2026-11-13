import { describe, expect, it } from "vitest";
import {
  generateWorkoutReport, hevyWorkoutSchema, renderWorkoutReport, type HevyWorkout,
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

  it("finds rep gains at the same loads while excluding warmup and non-normal sets", () => {
    const exercise = strength([9, 9]);
    exercise.sets.push(
      { type: "warmup", weight_kg: 50, reps: 100 },
      { type: "dropset", weight_kg: 50, reps: 100 },
      { type: "failure", weight_kg: 50, reps: 100 },
    );
    const report = generateWorkoutReport(workout(10, [exercise]), [workout(9, [strength([8, 8])])]);
    expect(report.achievements).toHaveLength(1);
    expect(report.achievements[0]).toContain("18 total reps vs 16 total reps");
    expect(report.patterns.join(" ")).not.toContain("across 4");
    expect(report.summary).toContain("2 normal working sets");
  });

  it("reports load increases at matched reps in the requested display units", () => {
    const report = generateWorkoutReport(
      workout(10, [strength([8, 8], 55)]), [workout(9, [strength([8, 8], 50)])], "lb",
    );
    expect(report.achievements[0]).toContain("121.3 lb average logged load vs 110.2 lb");
    expect(report.achievements[0]).toContain("same reps per set");
  });

  it("recognizes small recorded load increments without requiring a percentage jump", () => {
    const report = generateWorkoutReport(
      workout(10, [strength([5], 202.5)]), [workout(9, [strength([5], 200)])],
    );
    expect(report.achievements[0]).toContain("202.5 kg average logged load vs 200 kg");
  });

  it("compares explicit zero logged load but does not equate missing load with bodyweight", () => {
    const report = generateWorkoutReport(
      workout(10, [strength([12], 0)]), [workout(9, [strength([10], 0)])],
    );
    expect(report.achievements[0]).toContain("12 total reps vs 10 total reps");
    const missing = { ...strength([10]), sets: [{ type: "normal" as const, reps: 10, weight_kg: null }] };
    expect(generateWorkoutReport(workout(10, [strength([12], 0)]), [workout(9, [missing])]).achievements).toEqual([]);
  });

  it("does not compare different exercises, set counts or missing loads as zero", () => {
    for (const previous of [
      strength([8, 8], 50, "different"),
      strength([8], 50),
      { ...strength([8, 8]), sets: [{ type: "normal" as const, reps: 8 }, { type: "normal" as const, reps: 8 }] },
    ]) {
      const report = generateWorkoutReport(workout(10, [strength([10, 10])]), [workout(9, [previous])]);
      expect(report.achievements).toEqual([]);
      expect(report.patterns).toEqual([]);
      expect(report.limitations[0]).toContain("Not enough comparable history");
    }
  });

  it("does not infer gains from incomparable whole-workout totals or changed load-and-rep schemes", () => {
    const report = generateWorkoutReport(
      workout(10, [strength([5, 5], 70), strength([20], 10, "new-exercise")]),
      [workout(9, [strength([10, 10], 50)])],
    );
    expect(report.achievements).toEqual([]);
    expect(report.patterns).toEqual([]);
  });

  it("uses the nearest comparable session rather than a more favorable older metric", () => {
    const report = generateWorkoutReport(workout(10, [strength([8], 60)]), [
      workout(9, [strength([8], 65)]),
      workout(8, [strength([6], 60)]),
    ]);
    expect(report.achievements).toEqual([]);
    expect(report.patterns[0]).toContain("60 kg average logged load vs 65 kg");
  });

  it("distinguishes a one-session drop from a consistent multi-session trend", () => {
    const current = workout(10, [strength([6, 6])]);
    const one = generateWorkoutReport(current, [workout(9, [strength([8, 8])])]);
    expect(one.patterns[0]).toContain("not an established trend");
    const trend = generateWorkoutReport(current, [
      workout(7, [strength([9, 9])]), workout(9, [strength([7, 7])]), workout(8, [strength([8, 8])]),
    ]);
    expect(trend.patterns[0]).toContain("decreasing reps at matched loads across 4 comparable sessions");
    expect(trend.patterns[0]).not.toMatch(/injur|overtrain|danger/i);
  });

  it("identifies positive trends only with three prior consistent comparable sessions", () => {
    const current = workout(10, [strength([10, 10])]);
    const history = [workout(9, [strength([9, 9])]), workout(8, [strength([8, 8])]), workout(7, [strength([7, 7])])];
    expect(generateWorkoutReport(current, history).patterns[0]).toContain("improving reps");
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
    expect(report.achievements[0]).toContain("10 total reps vs 9 total reps");
    expect(report.patterns.join(" ")).not.toContain("across 4");
    expect(generateWorkoutReport(current, [old]).achievements).toEqual([]);
  });

  it("does not equate repeated exercise entries or mismatched per-set load layouts", () => {
    const report = generateWorkoutReport(
      workout(10, [strength([10]), strength([10])]), [workout(9, [strength([8])])],
    );
    expect(report.achievements).toEqual([]);
    expect(report.limitations.join(" ")).toContain("repeated exercise entries");
    const sets = (weights: number[], reps: number[]) =>
      weights.map((weight_kg, index): WorkoutSet => ({ index, type: "normal", weight_kg, reps: reps[index] }));
    const changed = generateWorkoutReport(
      workout(10, [{ ...strength([]), sets: sets([40, 60], [12, 8]) }]),
      [workout(9, [{ ...strength([]), sets: sets([50, 50], [10, 10]) }])],
    );
    expect(changed.achievements).toEqual([]);
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

  it("does not compare different interval layouts merely because activity totals match", () => {
    const intervals = (distances: number[]): Exercise => ({
      ...cardio(0),
      sets: distances.map((distance_meters, index) => ({
        index, type: "normal", distance_meters, duration_seconds: distance_meters * 0.3,
      })),
    });
    const report = generateWorkoutReport(
      workout(10, [intervals([1000, 4000])]), [workout(9, [intervals([2500, 2500])])],
    );
    expect(report.achievements).toEqual([]);
    expect(report.patterns).toEqual([]);
    expect(report.limitations[0]).toContain("Not enough comparable history");
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
