import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { rangeResponseSchema } from "@/components/report-chart";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn(), units: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireBetaUser: mocks.auth }));
vi.mock("@/lib/hevy-connection", async (original) => ({
  ...await original<typeof import("@/lib/hevy-connection")>(),
  loadHevyConnection: mocks.load,
}));

const owner = "00000000-0000-4000-8000-000000000001";
const entry = (workout: string, start: string, weight: number, reps: number, type = "normal") => ({
  workout_id: workout, workout_title: "Push", workout_start_time: start, workout_end_time: start, exercise_template_id: "BENCH_1",
  set_type: type, weight_kg: weight, reps, distance_meters: null, duration_seconds: null, rpe: null, custom_metric: null,
});
let history: unknown[];
let hevyStatus: number;
const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
  const url = new URL(input);
  if (hevyStatus !== 200) return new Response("", { status: hevyStatus });
  if (url.pathname.startsWith("/v1/exercise_templates/")) return Response.json({ id: "BENCH_1", title: "Bench Press (Barbell)" });
  void init;
  return Response.json({ exercise_history: history });
});
const request = (query: string) => new NextRequest(`https://nakama.test/api/hevy/exercise-history?${query}`);

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T12:00:00Z"));
  hevyStatus = 200;
  history = [
    entry("w1", "2026-03-02T10:00:00Z", 50, 10), // Monday
    entry("w2", "2026-03-04T10:00:00Z", 55, 10), // same ISO week, better
    entry("w2", "2026-03-04T10:00:00Z", 30, 10, "warmup"),
    entry("w3", "2026-11-18T09:00:00+01:00", 60, 5),
  ];
  mocks.units.mockResolvedValue({ data: { units: "kg" }, error: null });
  const query = { select: () => query, eq: () => query, maybeSingle: mocks.units };
  mocks.auth.mockResolvedValue({
    ok: true, user: { id: owner, email: "one@example.test" },
    session: { client: { from: () => query }, json: (body: unknown, status = 200) => NextResponse.json(body, { status }) },
  });
  mocks.load.mockResolvedValue({ apiKey: "personal-key", revision: "r1" });
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("rejects unauthenticated requests before touching Hevy", async () => {
  mocks.auth.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Please sign in." }, { status: 401 }) });
  expect((await GET(request("template=BENCH_1&range=9m&end=2026-11-18"))).status).toBe(401);
  expect(mocks.load).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each([
  "range=9m&end=2026-11-18",
  "template=BENCH/../x&range=9m&end=2026-11-18",
  `template=${"a".repeat(65)}&range=9m&end=2026-11-18`,
  "template=BENCH_1&range=2y&end=2026-11-18",
  "template=BENCH_1&range=9m&end=2026-02-30",
  "template=BENCH_1&range=9m&end=18-11-2026",
  "template=BENCH_1&range=9m&end=2026-11-20",
  "template=BENCH_1&range=9m&end=2026-11-18&user=someone-else",
])("rejects bad params: %s", async (query) => {
  const response = await GET(request(query));
  expect(response.status).toBe(400);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("accepts an end date one day ahead for time zones ahead of UTC", async () => {
  expect((await GET(request("template=BENCH_1&range=3m&end=2026-11-19"))).status).toBe(200);
});

it("uses only the signed-in user's key and returns weekly best sessions for 9m", async () => {
  const response = await GET(request("template=BENCH_1&range=9m&end=2026-11-18"));
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, max-age=300");
  expect(mocks.load).toHaveBeenCalledWith(owner);
  const call = fetchMock.mock.calls.map(([input, init]) => ({ url: new URL(input), init }))
    .find(({ url }) => url.pathname === "/v1/exercise_history/BENCH_1")!;
  expect(call.url.searchParams.get("start_date")).toBe("2026-02-17T00:00:00Z");
  expect(call.url.searchParams.get("end_date")).toBe("2026-11-19T23:59:59Z");
  expect(new Headers(call.init?.headers).get("api-key")).toBe("personal-key");
  const body = rangeResponseSchema.parse(await response.json());
  expect(body).toMatchObject({ range: "9m", granularity: "week" });
  expect(body.chart).toMatchObject({ v: 2, exercise_template_id: "BENCH_1", title: "Bench Press (Barbell)", current_date: "2026-11-18" });
  expect(body.chart.series[0].points).toEqual([{ date: "2026-03-02", value: 550 }, { date: "2026-11-16", value: 300 }]);
  expect(body.chart.series[1].points).toEqual([{ date: "2026-03-02", value: 55 }, { date: "2026-11-16", value: 60 }]);
});

it("returns per-session points for 3m in the user's units", async () => {
  mocks.units.mockResolvedValue({ data: { units: "lb" }, error: null });
  const body = rangeResponseSchema.parse(await (await GET(request("template=BENCH_1&range=3m&end=2026-11-18"))).json());
  expect(body.granularity).toBe("session");
  expect(body.chart.series[1]).toEqual({ key: "max_weight", label: "Max weight", unit: "lb", points: [{ date: "2026-11-18", value: 132.3 }] });
});

it("answers 404 without a Hevy connection", async () => {
  const { HevyConnectionError } = await import("@/lib/hevy-connection");
  mocks.load.mockRejectedValue(new HevyConnectionError(409, "Connect your own Hevy account before talking with your Nakama."));
  expect((await GET(request("template=BENCH_1&range=9m&end=2026-11-18"))).status).toBe(404);
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each([401, 429, 500])("answers a generic 502 when Hevy fails (%i)", async (status) => {
  hevyStatus = status;
  const response = await GET(request("template=BENCH_1&range=9m&end=2026-11-18"));
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "Hevy is temporarily unavailable. Please try again." });
});

it("answers 404 when the exercise has no sessions in range", async () => {
  hevyStatus = 404;
  expect((await GET(request("template=BENCH_1&range=9m&end=2026-11-18"))).status).toBe(404);
});
