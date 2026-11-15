import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HevyConnectionError } from "@/lib/hevy-connection";
import type { WorkoutReportRow } from "@/lib/supabase/database";
import {
  drainWorkoutReports, MAX_REPORT_ATTEMPTS, startWorkoutReportWorker, stopWorkoutReportWorker, wakeWorkoutReportWorker,
} from "./workout-report-worker";

const mocks = vi.hoisted(() => ({
  load: vi.fn(), generate: vi.fn(), storage: vi.fn(), actual: undefined as undefined | ((...args: never[]) => unknown),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/hevy-connection", async (original) => ({
  ...await original<typeof import("@/lib/hevy-connection")>(),
  loadHevyConnection: mocks.load, storage: mocks.storage,
}));
vi.mock("@/lib/workout-report", async (original) => {
  const actual = await original<typeof import("@/lib/workout-report")>();
  mocks.actual = actual.generateWorkoutReport as never;
  return { ...actual, generateWorkoutReport: mocks.generate };
});

const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const revision = "00000000-0000-4000-8000-0000000000aa";
const workoutId = "f1085cdb-32b2-4003-967d-53a3af8eaecb";
let clock: Date;

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

// In-memory stand-in for the supabase-js calls the worker makes; claim mirrors claim_next_workout_report.
function fakeDb(failInsert?: string) {
  const tables: Record<string, Row[]> = {
    workout_reports: [], chat_conversations: [],
    profiles: [{ user_id: owner, units: "kg" }, { user_id: other, units: "lb" }],
  };
  const query = (table: string) => {
    const filters: Filter[] = [];
    let action: { kind: "select" } | { kind: "update"; values: Row } = { kind: "select" };
    const rows = () => tables[table].filter((row) => filters.every((f) => f(row)));
    const run = () => {
      if (action.kind === "update") { const values = action.values; rows().forEach((row) => Object.assign(row, values)); }
      return { data: rows(), error: null };
    };
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return builder; },
      update: (values: Row) => { action = { kind: "update", values }; return builder; },
      maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => void) => resolve(run()),
      insert: async (row: Row) => {
        if (failInsert) return { error: { code: failInsert } };
        if (tables[table].some((r) => r.id === row.id)) return { error: { code: "23505" } };
        tables[table].push({ ...row });
        return { error: null };
      },
    };
    return builder;
  };
  const rpc = async (_name: string, { p_max_attempts }: { p_max_attempts: number }) => {
    const due = (tables.workout_reports as WorkoutReportRow[]).find((r) => Date.parse(r.available_at) <= clock.getTime()
      && (r.status === "queued" || (r.status === "failed" && r.attempts < p_max_attempts)));
    if (!due) return { data: [], error: null };
    Object.assign(due, { status: "processing", attempts: due.attempts + 1 });
    const { user_id, workout_id, connection_revision, conversation_id, attempts } = due;
    return { data: [{ user_id, workout_id, connection_revision, conversation_id, attempts }], error: null };
  };
  let conversations = 0;
  const enqueue = (userId = owner, id = workoutId, connectionRevision = revision) => tables.workout_reports.push({
    user_id: userId, workout_id: id, connection_revision: connectionRevision, status: "queued", attempts: 0,
    available_at: clock.toISOString(), conversation_id: `00000000-0000-4000-8000-${String(++conversations).padStart(12, "0")}`,
    last_error: null,
  });
  return { tables, enqueue, client: { from: query, rpc } as never };
}

function workout(id: string, day: number, weight: number) {
  const date = `2026-11-${String(day).padStart(2, "0")}`;
  return {
    id, title: "Legs", start_time: `${date}T09:00:00Z`, end_time: `${date}T10:00:00Z`,
    created_at: `${date}T10:00:00Z`, updated_at: `${date}T10:00:00Z`,
    exercises: [{
      index: 0, title: "Squat (Barbell)", exercise_template_id: "SQUAT", notes: null, superset_id: null,
      sets: [0, 1, 2].map((index) => ({
        index, type: "normal", weight_kg: weight, reps: 5, distance_meters: null, duration_seconds: null, rpe: null,
      })),
    }],
  };
}

let workoutsById: Record<string, unknown>;
let history: unknown[];
const fetchMock = vi.fn(async (input: URL | string, _init?: RequestInit) => {
  const url = new URL(input);
  if (url.pathname.startsWith("/v1/exercise_history/")) {
    const templateId = decodeURIComponent(url.pathname.split("/").pop()!);
    const from = Date.parse(url.searchParams.get("start_date")!);
    const to = Date.parse(url.searchParams.get("end_date")!);
    // Like Hevy: one entry per set, filtered by workout start time.
    const entries = (history as ReturnType<typeof workout>[])
      .filter((past) => Date.parse(past.start_time) >= from && Date.parse(past.start_time) <= to)
      .flatMap((past) => past.exercises.filter((e) => e.exercise_template_id === templateId).flatMap((e) => e.sets.map((set) => ({
        workout_id: past.id, workout_title: past.title, workout_start_time: past.start_time, workout_end_time: past.end_time,
        exercise_template_id: templateId, weight_kg: set.weight_kg, reps: set.reps, distance_meters: null,
        duration_seconds: null, rpe: null, custom_metric: null, set_type: set.type,
      }))));
    return Response.json({ exercise_history: entries });
  }
  const id = decodeURIComponent(url.pathname.split("/").pop()!);
  return workoutsById[id] ? Response.json(workoutsById[id]) : new Response("", { status: 404 });
});
const drain = (db: ReturnType<typeof fakeDb>) => drainWorkoutReports(db.client, () => clock);

beforeEach(() => {
  vi.clearAllMocks();
  clock = new Date("2026-11-13T12:00:00.000Z");
  mocks.generate.mockImplementation(mocks.actual!);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", fetchMock);
  mocks.load.mockResolvedValue({ apiKey: "personal-key", revision });
  const fresh = workout(workoutId, 12, 102.5);
  workoutsById = { [workoutId]: fresh };
  history = [fresh, workout("later", 14, 110), workout("h3", 9, 100), workout("h2", 6, 100), workout("h1", 3, 97.5)];
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("workout report worker", () => {
  it("delivers one in-app report for a queued webhook event, comparing against older workouts", async () => {
    const db = fakeDb();
    db.enqueue();
    expect(await drain(db)).toMatchObject({ claimed: 1, delivered: 1, failed: 0 });
    const [conversation] = db.tables.chat_conversations as { id: string; user_id: string; title: string; messages: { role: string; content: string }[] }[];
    expect(conversation).toMatchObject({ id: db.tables.workout_reports[0].conversation_id, user_id: owner, title: "Workout report: Legs" });
    expect(conversation.messages).toEqual([expect.objectContaining({ role: "assistant", content: expect.any(String) })]);
    expect(mocks.generate.mock.calls[0][1].map((w: { id: string }) => w.id).sort()).toEqual(["h1", "h2", "h3"]);
    expect(mocks.generate.mock.calls[0][2]).toBe("kg");
    expect(db.tables.workout_reports[0]).toMatchObject({ status: "delivered", attempts: 1, last_error: null });
    expect(fetchMock.mock.calls.every(([, init]) => JSON.stringify(init?.headers).includes("personal-key"))).toBe(true);
    expect(await drain(db)).toMatchObject({ claimed: 0 });
    expect(db.tables.chat_conversations).toHaveLength(1);
  });

  it("fetches 90-day exercise history once per distinct exercise with start and end dates", async () => {
    const db = fakeDb();
    db.enqueue();
    const fresh = workoutsById[workoutId] as ReturnType<typeof workout>;
    fresh.exercises.push({ ...fresh.exercises[0], index: 1, title: "Bench", exercise_template_id: "BENCH" });
    await drain(db);
    const calls = fetchMock.mock.calls.map(([input]) => new URL(input)).filter((url) => url.pathname.startsWith("/v1/exercise_history/"));
    expect(calls.map((url) => url.pathname).sort()).toEqual(["/v1/exercise_history/BENCH", "/v1/exercise_history/SQUAT"]);
    for (const url of calls) {
      expect(url.searchParams.get("start_date")).toBe("2026-08-14T09:00:00.000Z");
      expect(url.searchParams.get("end_date")).toBe("2026-11-12T09:00:00.000Z");
    }
    expect(fetchMock.mock.calls.some(([input]) => new URL(input).pathname === "/v1/workouts")).toBe(false);
  });

  it("caps exercises at 20 and requests at most 3 histories concurrently", async () => {
    const db = fakeDb();
    db.enqueue();
    const fresh = workoutsById[workoutId] as ReturnType<typeof workout>;
    fresh.exercises = Array.from({ length: 25 }, (_, i) => ({ ...fresh.exercises[0], index: i, exercise_template_id: `EX${i}` }));
    let active = 0;
    let peak = 0;
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      if (!new URL(input).pathname.startsWith("/v1/exercise_history/")) return base(input, init);
      active++; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return base(input, init);
    });
    expect(await drain(db)).toMatchObject({ delivered: 1 });
    const count = fetchMock.mock.calls.filter(([input]) => new URL(input).pathname.startsWith("/v1/exercise_history/")).length;
    expect(count).toBe(20);
    expect(peak).toBe(3);
    fetchMock.mockImplementation(base);
  });

  it("drops bad sets and entries without discarding the history", async () => {
    const db = fakeDb();
    db.enqueue();
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      if (!new URL(input).pathname.startsWith("/v1/exercise_history/")) return base(input, init);
      const body = await (await base(input, init)).json() as { exercise_history: (Record<string, unknown> | null)[] };
      body.exercise_history.push({ workout_id: "bad", reps: 5 }, { ...body.exercise_history[0]!, set_type: "mystery" },
        { ...body.exercise_history[0]!, reps: "five" }, null);
      return Response.json(body);
    });
    expect(await drain(db)).toMatchObject({ delivered: 1 });
    const past = mocks.generate.mock.calls[0][1] as { id: string; exercises: { sets: unknown[] }[] }[];
    expect(past.map((w) => w.id).sort()).toEqual(["h1", "h2", "h3"]);
    expect(past.every((w) => w.exercises[0].sets.length === 3)).toBe(true);
    fetchMock.mockImplementation(base);
  });

  it("treats a 404 for one exercise's history as empty without failing the report", async () => {
    const db = fakeDb();
    db.enqueue();
    const fresh = workoutsById[workoutId] as ReturnType<typeof workout>;
    fresh.exercises.push({ ...fresh.exercises[0], index: 1, title: "Custom", exercise_template_id: "CUSTOM" });
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) =>
      new URL(input).pathname === "/v1/exercise_history/CUSTOM" ? new Response("", { status: 404 }) : base(input, init));
    expect(await drain(db)).toMatchObject({ delivered: 1, failed: 0 });
    expect((mocks.generate.mock.calls[0][1] as { id: string }[]).map((w) => w.id).sort()).toEqual(["h1", "h2", "h3"]);
    fetchMock.mockImplementation(base);
  });

  it("fails with hevy_unavailable when an exercise history request errors, then recovers", async () => {
    const db = fakeDb();
    db.enqueue();
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) =>
      new URL(input).pathname.startsWith("/v1/exercise_history/") ? new Response("", { status: 500 }) : base(input, init));
    expect(await drain(db)).toMatchObject({ failed: 1 });
    expect(db.tables.workout_reports[0]).toMatchObject({ last_error: "hevy_unavailable" });
    fetchMock.mockImplementation(base);
    clock = new Date(clock.getTime() + 60_000);
    expect(await drain(db)).toMatchObject({ delivered: 1 });
  });

  it("uses each job owner's own Hevy connection and units", async () => {
    const db = fakeDb();
    db.enqueue(other);
    mocks.load.mockImplementation(async (userId: string) => ({ apiKey: `key-${userId}`, revision }));
    await drain(db);
    expect(mocks.load).toHaveBeenCalledWith(other);
    expect(JSON.stringify(fetchMock.mock.calls[0][1]?.headers)).toContain(`key-${other}`);
    expect(mocks.generate.mock.calls[0][2]).toBe("lb");
    expect(db.tables.chat_conversations[0]).toMatchObject({ user_id: other });
  });

  it("skips jobs queued for a replaced or removed Hevy connection without calling Hevy", async () => {
    const db = fakeDb();
    db.enqueue(owner, workoutId, "00000000-0000-4000-8000-0000000000bb");
    db.enqueue(other, "second");
    mocks.load.mockImplementation(async (userId: string) => {
      if (userId === other) throw new HevyConnectionError(409, "Connect");
      return { apiKey: "new-key", revision };
    });
    expect(await drain(db)).toMatchObject({ skipped: 2, delivered: 0 });
    expect(db.tables.workout_reports.map((r) => r.last_error)).toEqual(["connection_changed", "connection_removed"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips workouts Hevy no longer has", async () => {
    const db = fakeDb();
    db.enqueue(owner, "missing");
    expect(await drain(db)).toMatchObject({ skipped: 1 });
    expect(db.tables.workout_reports[0]).toMatchObject({ status: "skipped", last_error: "workout_not_found" });
  });

  it("backs off failed reports, retries when due, and stops at the attempt limit", async () => {
    const db = fakeDb();
    db.enqueue();
    mocks.generate.mockImplementation(() => { throw new Error("boom"); });
    expect(await drain(db)).toMatchObject({ failed: 1, exhausted: 0 });
    expect(db.tables.workout_reports[0]).toMatchObject({
      status: "failed", attempts: 1, last_error: "report_failed", available_at: "2026-11-13T12:01:00.000Z",
    });
    expect(await drain(db)).toMatchObject({ claimed: 0 });
    for (let attempt = 2; attempt <= MAX_REPORT_ATTEMPTS; attempt++) {
      clock = new Date(Date.parse(db.tables.workout_reports[0].available_at as string));
      expect(await drain(db)).toMatchObject({ failed: 1 });
    }
    expect(db.tables.workout_reports[0]).toMatchObject({ status: "failed", attempts: MAX_REPORT_ATTEMPTS });
    expect(console.error).toHaveBeenCalledWith("Workout report retries exhausted", expect.objectContaining({ code: "report_failed" }));
    clock = new Date(clock.getTime() + 86_400_000);
    expect(await drain(db)).toMatchObject({ claimed: 0 });
    expect(db.tables.chat_conversations).toEqual([]);
  });

  it("recovers on retry after Hevy is temporarily unavailable", async () => {
    const db = fakeDb();
    db.enqueue();
    fetchMock.mockResolvedValueOnce(new Response("", { status: 429 }));
    expect(await drain(db)).toMatchObject({ failed: 1 });
    expect(db.tables.workout_reports[0]).toMatchObject({ last_error: "hevy_unavailable" });
    clock = new Date(clock.getTime() + 60_000);
    expect(await drain(db)).toMatchObject({ delivered: 1 });
    expect(db.tables.workout_reports[0]).toMatchObject({ status: "delivered", attempts: 2, last_error: null });
  });

  it("records delivery failures and treats an already-saved report conversation as delivered", async () => {
    const failing = fakeDb("XX000");
    failing.enqueue();
    expect(await drain(failing)).toMatchObject({ failed: 1 });
    expect(failing.tables.workout_reports[0]).toMatchObject({ last_error: "delivery_failed" });

    const duplicate = fakeDb("23505");
    duplicate.enqueue();
    expect(await drain(duplicate)).toMatchObject({ delivered: 1 });
  });

  it("rejects a Hevy response for a different workout", async () => {
    const db = fakeDb();
    db.enqueue();
    workoutsById[workoutId] = workout("someone-else", 12, 100);
    expect(await drain(db)).toMatchObject({ failed: 1 });
    expect(db.tables.workout_reports[0]).toMatchObject({ last_error: "invalid_workout" });
  });
});

describe("in-process worker lifecycle", () => {
  afterEach(async () => { await stopWorkoutReportWorker(); });

  it("does nothing on wake until started, then drains on start and on each wake", async () => {
    const db = fakeDb();
    mocks.storage.mockReturnValue(db.client);
    db.enqueue();
    wakeWorkoutReportWorker();
    await Promise.resolve();
    expect(mocks.storage).not.toHaveBeenCalled();

    startWorkoutReportWorker();
    await vi.waitFor(() => expect(db.tables.workout_reports[0].status).toBe("delivered"));
    db.enqueue(owner, "second");
    workoutsById.second = { ...workout("second", 13, 105) };
    wakeWorkoutReportWorker();
    await vi.waitFor(() => expect(db.tables.workout_reports[1].status).toBe("delivered"));
  });

  it("keeps running after a drain failure so the next wake or sweep retries", async () => {
    mocks.storage.mockImplementationOnce(() => { throw new Error("database down"); });
    startWorkoutReportWorker();
    await vi.waitFor(() => expect(console.error).toHaveBeenCalledWith("Workout report worker drain failed", { error: "database down" }));
    const db = fakeDb();
    mocks.storage.mockReturnValue(db.client);
    db.enqueue();
    wakeWorkoutReportWorker();
    await vi.waitFor(() => expect(db.tables.workout_reports[0].status).toBe("delivered"));
  });
});
