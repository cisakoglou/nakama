import "server-only";
import { tool } from "ai";
import { z } from "zod";
import { HevyConnectionError } from "@/lib/hevy-connection";
import { HevyRequestError, type HevyClient } from "@/lib/hevy-client";

const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const number = z.coerce.number().finite();
const integer = number.int();
const setType = z.enum(["warmup", "normal", "failure", "dropset"]).default("normal");
const repRange = z.object({ start: integer.nullish(), end: integer.nullish() }).strict();
const routineSet = z.object({
  type: setType, weight_kg: number.optional(), reps: integer.nullish(),
  distance_meters: integer.optional(), duration_seconds: integer.optional(),
  custom_metric: number.optional(), rep_range: repRange.nullish(),
}).strict();
const workoutSet = z.object({
  type: setType, weight_kg: number.nullish(), reps: integer.nullish(),
  distance_meters: integer.nullish(), duration_seconds: integer.nullish(), custom_metric: number.nullish(),
  rpe: z.preprocess(value => value === undefined || value === null ? value : String(value),
    z.enum(["6", "7", "7.5", "8", "8.5", "9", "9.5", "10"]).transform(Number).nullish()),
}).strict();

function arrayInput<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(value => {
    if (typeof value !== "string") return value;
    try { return JSON.parse(value) as unknown; }
    catch (error) { if (!(error instanceof SyntaxError)) throw error; return value; }
  }, schema);
}

const routineExercises = arrayInput(z.array(z.object({
  exercise_template_id: id, superset_id: number.nullish(), rest_seconds: integer.min(0).optional(),
  notes: z.string().optional(), sets: z.array(routineSet).min(1),
}).strict()).min(1));
const routineFields = { title: z.string().min(1), notes: z.string().optional(), exercises: routineExercises };
const routineInput = z.object({ ...routineFields, folder_id: number.nullish() }).strict();
const routineUpdate = z.object(routineFields).strict();
const timestamp = z.string().datetime({ precision: 0 }).refine(value =>
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace(".000Z", "Z") === value);
const workoutInput = z.object({
  title: z.string().min(1), description: z.string().nullish(), start_time: timestamp, end_time: timestamp,
  is_private: z.boolean().default(false),
  exercises: arrayInput(z.array(z.object({
    exercise_template_id: id, superset_id: number.nullish(), notes: z.string().nullish(), sets: z.array(workoutSet),
  }).strict())),
}).strict();

const optionalNumber = z.number().finite().nullish();
const optionalText = z.string().nullish();
const responseSet = z.object({
  index: optionalNumber, type: optionalText, weight_kg: optionalNumber, reps: optionalNumber,
  distance_meters: optionalNumber, duration_seconds: optionalNumber, rpe: optionalNumber, custom_metric: optionalNumber,
});
const responseExerciseFields = {
  index: optionalNumber, title: optionalText, exercise_template_id: optionalText, notes: optionalText,
  superset_id: optionalNumber, supersets_id: optionalNumber,
};
const workoutResponse = z.object({
  id: z.string(), title: z.string(), routine_id: optionalText, description: optionalText,
  start_time: optionalText, end_time: optionalText, created_at: optionalText, updated_at: optionalText,
  exercises: z.array(z.object({ ...responseExerciseFields, sets: z.array(responseSet).optional() })).optional(),
});
const routineResponse = z.object({
  id: z.string().optional(), title: z.string().optional(), folder_id: optionalNumber,
  created_at: optionalText, updated_at: optionalText,
  exercises: z.array(z.object({
    ...responseExerciseFields, rest_seconds: optionalNumber,
    sets: z.array(responseSet.extend({
      rep_range: z.object({ start: optionalNumber, end: optionalNumber }).nullish(),
    })).optional(),
  })).optional(),
});
const templateResponse = z.object({
  id: z.string(), title: z.string(), type: optionalText, primary_muscle_group: optionalText,
  secondary_muscle_groups: z.array(z.string()).optional(), is_custom: z.boolean().optional(),
});
const historyResponse = z.object({
  workout_id: optionalText, workout_title: optionalText, workout_start_time: optionalText, workout_end_time: optionalText,
  exercise_template_id: optionalText, weight_kg: optionalNumber, reps: optionalNumber, distance_meters: optionalNumber,
  duration_seconds: optionalNumber, rpe: optionalNumber, custom_metric: optionalNumber, set_type: optionalText,
});

function parseResponse<T>(schema: z.ZodType<T>, value: unknown, method: "GET" | "POST" | "PUT" = "GET"): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HevyRequestError(200, method);
  return parsed.data;
}

function sparse(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sparse);
  if (value !== null && typeof value === "object") {
    const record = z.record(z.unknown()).parse(value);
    const { superset_id, supersets_id, ...fields } = record;
    if (superset_id != null || supersets_id != null) fields.supersets_id = superset_id ?? supersets_id;
    return Object.fromEntries(Object.entries(fields)
      .filter(([, entry]) => entry !== null && entry !== undefined).map(([key, entry]) => [key, sparse(entry)])
      .filter(([key, entry]) => key !== "rep_range" || Object.keys(z.record(z.unknown()).parse(entry)).length > 0));
  }
  return value;
}

function duration(workout: z.infer<typeof workoutResponse>) {
  if (!workout.start_time || !workout.end_time) return "Unknown duration";
  const seconds = (Date.parse(workout.end_time) - Date.parse(workout.start_time)) / 1000;
  if (!Number.isFinite(seconds)) return "Unknown duration";
  if (seconds < 0) return "Invalid duration (end time before start time)";
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m ${Math.floor(seconds % 60)}s`;
}

function workoutDetail(workout: z.infer<typeof workoutResponse>) {
  return sparse({ ...workout, duration: duration(workout) });
}

function counts(exercises: { sets?: unknown[] }[] = []) {
  return { exercise_count: exercises.length, set_count: exercises.reduce((sum, exercise) => sum + (exercise.sets?.length ?? 0), 0) };
}

function routinePayload(routine: z.infer<typeof routineInput>, create: boolean) {
  let usesRepRanges = false;
  const exercises = routine.exercises.map(exercise => ({
    exercise_template_id: exercise.exercise_template_id, superset_id: exercise.superset_id ?? null,
    rest_seconds: exercise.rest_seconds ?? null, notes: exercise.notes ?? null,
    sets: exercise.sets.map(set => {
      const range = set.rep_range && (set.rep_range.start != null || set.rep_range.end != null) ? set.rep_range : null;
      const fixedReps = range?.start != null && range.start === range.end ? range.start : null;
      if (range && fixedReps === null) usesRepRanges = true;
      return {
        type: set.type, weight_kg: set.weight_kg ?? null, reps: set.reps ?? fixedReps,
        distance_meters: set.distance_meters ?? null, duration_seconds: set.duration_seconds ?? null,
        custom_metric: set.custom_metric ?? null, ...(create || range ? { rep_range: range } : {}),
      };
    }),
  }));
  return {
    payload: {
      title: routine.title, ...(create ? { folder_id: routine.folder_id ?? null } : {}),
      notes: routine.notes ?? (create ? "" : null), exercises,
    },
    usesRepRanges,
  };
}

const rangeWarning = "Note: Hevy stores rep ranges, but its apps may not display them. Check the routine in Hevy.";
const pagination = (max: number, size: number) => z.object({
  page: integer.min(1), page_size: integer.min(1).max(max).default(size),
}).strict();

export function createHevyTools(client: HevyClient, beforeCall: () => Promise<void>) {
  const text = (value: unknown) => JSON.stringify(value, null, 2);
  function define<T extends z.ZodTypeAny>(
    name: string, description: string, inputSchema: T, write: boolean,
    execute: (args: z.output<T>) => Promise<string>,
  ) {
    return tool<unknown, unknown>({
      description, inputSchema, needsApproval: write,
      execute: async input => {
        const parsed = inputSchema.safeParse(input);
        if (!parsed.success) throw new HevyConnectionError(400, `Invalid arguments for ${name}.`);
        await beforeCall();
        return execute(parsed.data);
      },
    });
  }
  async function page<T>(path: string, key: string, item: z.ZodType<T>, requested: number, size: number) {
    let raw: unknown;
    try { raw = await client.request(path, { query: { page: requested, pageSize: size } }); }
    catch (error) {
      if (error instanceof HevyRequestError && error.providerStatus === 404 && requested > 1) return [];
      throw error;
    }
    const parsed = parseResponse(z.object({
      page: z.number().optional(), page_count: z.number().int().nonnegative().optional(), [key]: z.array(item),
    }), raw);
    if (parsed.page !== undefined && parsed.page !== requested) throw new HevyRequestError(200);
    return z.array(item).parse(parsed[key]);
  }
  async function get<T>(path: string, schema: z.ZodType<T>) {
    try {
      const raw = await client.request(path);
      // Hevy also uses an empty object, rather than 404, for absent individual records.
      if (raw === null || z.object({}).strict().safeParse(raw).success) return null;
      return parseResponse(schema, raw);
    }
    catch (error) {
      if (error instanceof HevyRequestError && error.providerStatus === 404) return null;
      throw error;
    }
  }
  let catalog: Promise<z.infer<typeof templateResponse>[]> | undefined;
  function templates(refresh: boolean) {
    if (!catalog || refresh) catalog = (async () => {
      const items: z.infer<typeof templateResponse>[] = [];
      for (let requested = 1; requested <= 100; requested++) {
        const result = parseResponse(z.object({
          page: z.number().optional(), page_count: z.number().int().nonnegative(),
          exercise_templates: z.array(templateResponse),
        }), await client.request("/exercise_templates", { query: { page: requested, pageSize: 100 } }));
        if ((result.page !== undefined && result.page !== requested)
          || (result.page_count === 0 && result.exercise_templates.length > 0)
          || (result.page_count > 0 && result.page_count < requested)
          || (result.page_count > requested && result.exercise_templates.length === 0)) throw new HevyRequestError(200);
        items.push(...result.exercise_templates);
        if (result.page_count <= requested) return items;
      }
      throw new HevyConnectionError(502, "Hevy's exercise catalog exceeded the supported page limit; search results would be incomplete.");
    })().catch(error => { catalog = undefined; throw error; });
    return catalog;
  }
  return {
    "get-workouts": define("get-workouts", "List compact workout summaries in Hevy pagination order. Use get-workout for sets.", pagination(10, 5), false,
      async args => {
        const items = await page("/workouts", "workouts", workoutResponse, args.page, args.page_size);
        return items.length ? text(items.map(workout => sparse({
          id: workout.id, title: workout.title, start_time: workout.start_time, end_time: workout.end_time,
          duration: duration(workout), ...counts(workout.exercises),
        }))) : "No workouts found for the specified parameters";
      }),
    "get-workout": define("get-workout", "Get one workout with exercises and sets.", z.object({ workout_id: id }).strict(), false,
      async args => {
        const workout = await get(`/workouts/${args.workout_id}`, workoutResponse);
        return workout ? text(workoutDetail(workout)) : `Workout with ID ${args.workout_id} not found`;
      }),
    "get-workout-count": define("get-workout-count", "Get the total number of workouts.", z.object({}).strict(), false,
      async () => text(parseResponse(z.object({ workout_count: z.number().int().nonnegative() }), await client.request("/workouts/count")))),
    "get-exercise-templates": define("get-exercise-templates", "List exercise templates and their IDs by page.", pagination(100, 100), false,
      async args => {
        const items = await page("/exercise_templates", "exercise_templates", templateResponse, args.page, args.page_size);
        return items.length ? text(sparse(items)) : "No exercise templates found for the specified parameters";
      }),
    "search-exercise-templates": define("search-exercise-templates", "Find exercise IDs by case-insensitive title and optional muscle group. The catalog is cached within this chat request.",
      z.object({
        query: z.string().min(1), refresh: z.boolean().default(false),
        primary_muscle_group: z.enum(["abdominals", "shoulders", "biceps", "triceps", "forearms", "quadriceps", "hamstrings",
          "calves", "glutes", "abductors", "adductors", "lats", "upper_back", "traps", "lower_back", "chest", "cardio", "neck", "full_body", "other"]).optional(),
      }).strict(), false, async args => {
        const items = (await templates(args.refresh)).filter(template => template.title.toLowerCase().includes(args.query.toLowerCase())
          && (args.primary_muscle_group === undefined || template.primary_muscle_group === args.primary_muscle_group));
        return items.length ? text(sparse(items)) : `No exercise templates found matching "${args.query}"${args.primary_muscle_group ? ` with primary muscle group "${args.primary_muscle_group}"` : ""}`;
      }),
    "get-exercise-template": define("get-exercise-template", "Get an exercise template by its discovered ID.", z.object({ exercise_template_id: id }).strict(), false,
      async args => {
        const template = await get(`/exercise_templates/${args.exercise_template_id}`, templateResponse);
        return template ? text(sparse(template)) : `Exercise template with ID ${args.exercise_template_id} not found`;
      }),
    "get-exercise-history": define("get-exercise-history", "Get performed sets for an exercise, optionally bounded by ISO timestamps.",
      z.object({ exercise_template_id: id, start_date: z.string().datetime({ offset: true }).optional(), end_date: z.string().datetime({ offset: true }).optional() }).strict(),
      false, async ({ exercise_template_id: template, ...dates }) => {
        const query = Object.fromEntries(Object.entries(dates).filter((entry): entry is [string, string] => entry[1] !== undefined));
        const history = parseResponse(z.object({ exercise_history: z.array(historyResponse) }),
          await client.request(`/exercise_history/${template}`, { query })).exercise_history;
        return history.length ? text(sparse(history)) : `No exercise history found for template ${template}`;
      }),
    "get-routines": define("get-routines", "List compact routine summaries. Use get-routine for exercises and sets.", pagination(10, 5), false,
      async args => {
        const items = await page("/routines", "routines", routineResponse, args.page, args.page_size);
        return items.length ? text(items.map(routine => sparse({
          id: routine.id, title: routine.title, folder_id: routine.folder_id, updated_at: routine.updated_at, ...counts(routine.exercises),
        }))) : "No routines found for the specified parameters";
      }),
    "get-routine": define("get-routine", "Get a routine with exercises and sets.", z.object({ routine_id: id }).strict(), false,
      async args => {
        const result = await get(`/routines/${args.routine_id}`, z.object({ routine: routineResponse.nullable() }));
        return result?.routine ? text(sparse(result.routine)) : `Routine with ID ${args.routine_id} not found`;
      }),
    "create-routine": define("create-routine", "Create a reusable routine. Discover exercise IDs first. Repeating this action can create duplicates.",
      z.object({ routine: routineInput }).strict(), true, async ({ routine }) => {
        const { payload, usesRepRanges } = routinePayload(routine, true);
        const result = parseResponse(z.object({ routine: routineResponse.nullish() }),
          await client.request("/routines", { method: "POST", body: { routine: payload } }), "POST");
        const created = result.routine?.id ? result.routine : null;
        return [text({
          created: true, commit_state: "confirmed", routine: sparse(created), routine_id: created?.id ?? null, uses_rep_ranges: usesRepRanges,
        }), ...(usesRepRanges ? [rangeWarning] : []),
        ...(!created ? ["Hevy confirmed routine creation but did not return an ID. Search routines before retrying to avoid duplicates."] : [])].join("\n");
      }),
    "update-routine": define("update-routine", "Replace a routine's title and exercises. Omitted exercises are removed.",
      z.object({ routine_id: id, routine: routineUpdate }).strict(), true, async ({ routine_id: routineId, routine }) => {
        const { payload, usesRepRanges } = routinePayload(routine, false);
        const result = parseResponse(z.object({ routine: routineResponse.nullish() }),
          await client.request(`/routines/${routineId}`, { method: "PUT", body: { routine: payload } }), "PUT");
        return [result.routine ? text(sparse(result.routine)) : `Hevy confirmed the update to routine ${routineId} but did not return the routine.`,
          ...(usesRepRanges ? [rangeWarning] : [])].join("\n");
      }),
    "create-workout": define("create-workout", "Log a completed workout with actual sets and UTC timestamps. Repeating this action can create duplicates.",
      z.object({ workout: workoutInput }).strict(), true, async args => {
        const result = parseResponse(z.object({ workout: z.union([workoutResponse, z.array(workoutResponse).length(1)]) }),
          await client.request("/workouts", { method: "POST", body: args }), "POST");
        return text(workoutDetail(Array.isArray(result.workout) ? result.workout[0] : result.workout));
      }),
  };
}
