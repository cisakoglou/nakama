import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createNodeMcpServer } from "hevy-mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { generateText } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { createHevyClient } from "./hevy-client";
import { createHevyTools } from "./hevy-tools";

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/hevy-oauth", () => ({ loadHevyCredentials: mocks.load }));
vi.mock("@/lib/hevy-rate-limit", () => ({ waitForHevyRequest: vi.fn().mockResolvedValue(undefined) }));

const set = { index: 0, type: "normal", weight_kg: 50, reps: 8, distance_meters: null, duration_seconds: null, rpe: 8, custom_metric: null };
const exercise = {
  index: 0, title: "Bench press", exercise_template_id: "BENCH", notes: null, superset_id: 2, sets: [set],
};
const workout = {
  id: "workout-one", title: "Training", description: null, routine_id: null,
  start_time: "2026-11-18T10:00:00Z", end_time: "2026-11-18T11:00:00Z",
  created_at: "2026-11-18T11:00:00Z", updated_at: "2026-11-18T11:00:00Z", exercises: [exercise],
};
const routine = {
  id: "routine-one", title: "Push", folder_id: null, updated_at: "2026-11-18T11:00:00Z",
  exercises: [{ ...exercise, rest_seconds: 90, sets: [{ ...set, reps: null, rep_range: { start: 8, end: 12 } }] }],
};
const template = { id: "BENCH", title: "Bench press", type: "weight_reps", primary_muscle_group: "chest", secondary_muscle_groups: ["triceps"], is_custom: false };
const history = [{
  workout_id: workout.id, workout_title: workout.title, workout_start_time: workout.start_time, workout_end_time: workout.end_time,
  exercise_template_id: "BENCH", weight_kg: 50, reps: 8, distance_meters: null, duration_seconds: null, rpe: 8, custom_metric: null, set_type: "normal",
}];
const routineArgs = {
  title: "Push", exercises: [{ exercise_template_id: "BENCH", rest_seconds: 90, sets: [{ type: "normal", reps: null, rep_range: { start: 8, end: 12 } }] }],
};
const workoutArgs = {
  title: "Training", start_time: workout.start_time, end_time: workout.end_time,
  exercises: [{ exercise_template_id: "BENCH", sets: [{ weight_kg: 50, reps: 8, rpe: 8 }] }],
};
type ToolName = keyof ReturnType<typeof createHevyTools>;
const cases: { name: ToolName; args: Record<string, unknown>; path: string }[] = [
  { name: "get-workouts", args: { page: 1 }, path: "/v1/workouts" },
  { name: "get-workout", args: { workout_id: "workout-one" }, path: "/v1/workouts/workout-one" },
  { name: "get-workout-count", args: {}, path: "/v1/workouts/count" },
  { name: "get-exercise-templates", args: { page: 1 }, path: "/v1/exercise_templates" },
  { name: "search-exercise-templates", args: { query: "BENCH", primary_muscle_group: "chest" }, path: "/v1/exercise_templates" },
  { name: "get-exercise-template", args: { exercise_template_id: "BENCH" }, path: "/v1/exercise_templates/BENCH" },
  { name: "get-exercise-history", args: { exercise_template_id: "BENCH", start_date: workout.start_time }, path: "/v1/exercise_history/BENCH" },
  { name: "get-routines", args: { page: 1 }, path: "/v1/routines" },
  { name: "get-routine", args: { routine_id: "routine-one" }, path: "/v1/routines/routine-one" },
  { name: "create-routine", args: { routine: routineArgs }, path: "/v1/routines" },
  { name: "update-routine", args: { routine_id: "routine-one", routine: routineArgs }, path: "/v1/routines/routine-one" },
  { name: "create-workout", args: { workout: workoutArgs }, path: "/v1/workouts" },
];
type Call = { url: URL; method: string; body: unknown; headers: Headers };
let calls: Call[];
const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : input);
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : input instanceof Request ? await input.clone().json().catch(() => undefined) : undefined;
  calls.push({ url, method, body, headers: new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)) });
  if (url.pathname === "/v1/workouts/count") return Response.json({ workout_count: 7 });
  if (url.pathname === "/v1/workouts") return method === "POST"
    ? Response.json({ workout: [workout] }, { status: 201 })
    : Response.json({ workouts: [workout], page: 1, page_count: 1 });
  if (url.pathname === "/v1/workouts/workout-one") return Response.json(workout);
  if (url.pathname === "/v1/routines") return method === "POST"
    ? Response.json({ routine }, { status: 201 }) : Response.json({ routines: [routine], page: 1, page_count: 1 });
  if (url.pathname === "/v1/routines/routine-one") return Response.json({ routine });
  if (url.pathname === "/v1/exercise_templates") return Response.json({
    exercise_templates: [Number(url.searchParams.get("page")) === 1 ? template : { ...template, id: "CUSTOM", title: "Custom squat", primary_muscle_group: "quadriceps", is_custom: true }],
    page: Number(url.searchParams.get("page")), page_count: 2,
  });
  if (url.pathname === "/v1/exercise_templates/BENCH") return Response.json(template);
  if (url.pathname === "/v1/exercise_history/BENCH") return Response.json({ exercise_history: history });
  throw new Error(`Unexpected contract-test URL: ${url}`);
});

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

async function execute(tools: ReturnType<typeof createHevyTools>, name: ToolName, args: unknown) {
  const run = tools[name].execute;
  if (!run) throw new Error("Missing local tool executor");
  const result = await run(args, { toolCallId: "contract-call", messages: [] });
  if (typeof result !== "string") throw new Error("Unexpected tool output");
  return result;
}

for (const method of ["api_key", "oauth"] as const) {
  it.each(cases)(`${method}: preserves $name arguments/results and approval metadata`, async ({ name, args, path }) => {
    mocks.load.mockResolvedValue(method === "api_key"
      ? { method, apiKey: "personal-key", revision: "connection" }
      : { method, accessToken: "private-token", tokenVersion: 1, revision: "connection" });
    const guard = vi.fn().mockResolvedValue(undefined);
    const tools = createHevyTools(await createHevyClient("one"), guard);
    const result = await execute(tools, name, args);
    expect(guard).toHaveBeenCalledTimes(1);
    expect(calls[0].url.pathname).toBe(path);
    expect(tools[name].needsApproval).toBe(["create-routine", "update-routine", "create-workout"].includes(name));
    for (const call of calls) {
      expect(call.headers.get(method === "api_key" ? "api-key" : "Authorization"))
        .toBe(method === "api_key" ? "personal-key" : "Bearer private-token");
      expect(call.headers.has(method === "api_key" ? "Authorization" : "api-key")).toBe(false);
    }
    expect(result).not.toMatch(/personal-key|private-token/);
    // These two allowed names are no longer exposed as tools by hevy-mcp 6.2.1.
    if (name === "get-workout-count") {
      expect(JSON.parse(result)).toEqual({ workout_count: 7 });
      return;
    }
    if (name === "get-exercise-templates") {
      expect(JSON.parse(result)).toEqual([template]);
      expect(calls[0].url.searchParams.get("pageSize")).toBe("100");
      return;
    }
    const localCalls = calls.splice(0);
    const server = await createNodeMcpServer({ apiKey: "upstream-contract-fixture", maxGetRetries: 0 });
    const upstream = new Client({ name: "nakama-contract", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await upstream.connect(clientTransport);
      const expected = await upstream.callTool({ name, arguments: args });
      expect(expected.isError).not.toBe(true);
      const content = expected.content;
      if (!Array.isArray(content) || content[0]?.type !== "text" || typeof content[0].text !== "string") throw new Error("Unexpected MCP fixture output");
      // The upstream adapter loses the documented single-element POST workout array.
      if (name === "create-workout") expect(JSON.parse(result)).toMatchObject({ id: workout.id, duration: "1h 0m 0s", exercises: [expect.objectContaining({ exercise_template_id: "BENCH" })] });
      else expect(JSON.parse(result.split("\nNote:")[0])).toEqual(JSON.parse(content[0].text));
      const requests = (entries: Call[]) => entries.map(call => ({ path: call.url.pathname, query: call.url.search, body: call.body, method: call.method }));
      expect(requests(localCalls)).toEqual(requests(calls));
    } finally {
      await upstream.close();
      await server.close();
    }
  });
}

it("shares only a request-local catalog, includes later custom-template pages, and can refresh it", async () => {
  mocks.load.mockResolvedValue({ method: "api_key", apiKey: "one", revision: "one" });
  const client = await createHevyClient("one");
  const tools = createHevyTools(client, async () => {});
  const squat = JSON.parse(await execute(tools, "search-exercise-templates", { query: "squat" }));
  expect(squat[0]).toMatchObject({ id: "CUSTOM", is_custom: true });
  await execute(tools, "search-exercise-templates", { query: "bench" });
  expect(calls).toHaveLength(2);
  await execute(tools, "search-exercise-templates", { query: "bench", refresh: true });
  expect(calls).toHaveLength(4);
  await execute(createHevyTools(client, async () => {}), "search-exercise-templates", { query: "bench" });
  expect(calls).toHaveLength(6);
});

it("does not cache incomplete pagination as a successful empty search", async () => {
  mocks.load.mockResolvedValue({ method: "api_key", apiKey: "one", revision: "one" });
  const tools = createHevyTools(await createHevyClient("one"), async () => {});
  fetchMock.mockResolvedValueOnce(Response.json({ exercise_templates: [] }));
  await expect(execute(tools, "search-exercise-templates", { query: "bench" })).rejects.toMatchObject({ status: 502 });
  expect(JSON.parse(await execute(tools, "search-exercise-templates", { query: "bench" }))).toHaveLength(1);
});

it.each([
  { name: "get-workout", args: { workout_id: "workout-one" } },
  { name: "get-exercise-template", args: { exercise_template_id: "BENCH" } },
] satisfies { name: ToolName; args: unknown }[])("preserves Hevy's empty-object absence response for $name", async ({ name, args }) => {
  mocks.load.mockResolvedValue({ method: "api_key", apiKey: "one", revision: "one" });
  fetchMock.mockResolvedValueOnce(Response.json({}));
  const tools = createHevyTools(await createHevyClient("one"), async () => {});
  expect(await execute(tools, name, args)).toContain("not found");
});

it.each([
  { name: "get-workout", args: { workout_id: "../other" } },
  { name: "create-routine", args: { routine: { ...routineArgs, exercises: [] } } },
  { name: "update-routine", args: { routine_id: "routine-one", routine: { ...routineArgs, folder_id: 3 } } },
  { name: "create-workout", args: { workout: { ...workoutArgs, start_time: "2026-02-30T00:00:00Z" } } },
] satisfies { name: ToolName; args: unknown }[])("rejects invalid $name inputs before reaching Hevy", async ({ name, args }) => {
  mocks.load.mockResolvedValue({ method: "api_key", apiKey: "one", revision: "one" });
  const tools = createHevyTools(await createHevyClient("one"), async () => {});
  await expect(execute(tools, name, args)).rejects.toMatchObject({ status: 400 });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("preserves confirmed creation with a missing ID as a warning, not an invitation to repeat the write", async () => {
  mocks.load.mockResolvedValue({ method: "api_key", apiKey: "one", revision: "one" });
  const tools = createHevyTools(await createHevyClient("one"), async () => {});
  fetchMock.mockResolvedValueOnce(Response.json({}, { status: 201 }));
  const result = await execute(tools, "create-routine", { routine: routineArgs });
  expect(result).toContain('"commit_state": "confirmed"');
  expect(result).toContain('"routine_id": null');
  expect(result).toContain("before retrying to avoid duplicates");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each(cases.filter(entry => entry.name.startsWith("create-") || entry.name === "update-routine"))(
  "the real AI SDK does not execute $name until its specific approval is accepted", async ({ name, args }) => {
    mocks.load.mockResolvedValue({ method: "oauth", accessToken: "private-token", tokenVersion: 1, revision: "connection" });
    const tools = createHevyTools(await createHevyClient("one"), async () => {});
    for (const approved of [false, true]) {
      const usage = {
        inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 1, text: 1, reasoning: undefined },
      };
      const proposal = await generateText({
        model: new MockLanguageModelV3({ doGenerate: {
          content: [{ type: "tool-call", toolCallId: "write-one", toolName: name, input: JSON.stringify(args) }],
          finishReason: { unified: "tool-calls", raw: "tool-calls" }, usage, warnings: [],
        } }),
        tools, messages: [{ role: "user", content: "Propose this Hevy change." }],
      });
      expect(fetchMock).not.toHaveBeenCalled();
      const approvals = proposal.response.messages.flatMap(message => message.role === "assistant" && Array.isArray(message.content)
        ? message.content.filter(part => part.type === "tool-approval-request") : []);
      const approval = approvals[0];
      if (!approval || approval.type !== "tool-approval-request") throw new Error("Missing SDK approval request");
      await generateText({
        model: new MockLanguageModelV3({ doGenerate: {
          content: [{ type: "text", text: "Done." }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [],
        } }),
        tools,
        messages: [{ role: "user", content: "Propose this Hevy change." }, ...proposal.response.messages, {
          role: "tool", content: [{ type: "tool-approval-response", approvalId: approval.approvalId, approved }],
        }],
      });
      expect(fetchMock).toHaveBeenCalledTimes(approved ? 1 : 0);
    }
  });
