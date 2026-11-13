import { z } from "zod";

const timestampSchema = z.string().datetime({ offset: true });
const recoverySnapshotSchema = z.object({
  userId: z.string().min(1),
  provider: z.literal("garmin"),
  status: z.enum(["available", "missing", "unavailable"]),
  fetchedAt: timestampSchema,
  sleep: z.object({
    calendarDate: z.string().date(),
    startAt: timestampSchema,
    endAt: timestampSchema,
    // Measured main sleep excludes awake time and naps; it is not the window's elapsed duration.
    sleepSeconds: z.number().finite().int().nonnegative(),
    quality: z.enum(["poor", "average", "good", "excellent"]).optional(),
    windowConfirmed: z.boolean(),
  }).optional(),
});

export type RecoverySnapshot = z.infer<typeof recoverySnapshotSchema>;
export type RecoveryContext = { observations: readonly string[]; limitations: readonly string[] };

// An episode must end within the preceding day; this is a matching policy, not a medical threshold.
const MAX_SLEEP_AGE_MS = 24 * 60 * 60 * 1000;

function limitation(message: string): RecoveryContext {
  return { observations: [], limitations: [message] };
}

export function buildRecoveryContext(
  workoutStartTime: string,
  ownerId: string,
  snapshot?: RecoverySnapshot,
): RecoveryContext | undefined {
  // The caller supplies a snapshot only for a connected account with explicit recovery consent.
  if (!snapshot || snapshot.userId !== ownerId) return undefined;
  const parsed = recoverySnapshotSchema.safeParse(snapshot);
  if (!parsed.success) {
    return limitation("Garmin recovery data could not be validated. No recovery measurements were used.");
  }
  const data = parsed.data;
  if (data.status === "unavailable") {
    return limitation("Garmin recovery data is temporarily unavailable; this report uses Hevy workout data only.");
  }
  if (data.status === "missing" || !data.sleep) {
    return limitation("Garmin sleep data is missing for this session; the workout comparison remains based on Hevy data.");
  }
  if (!timestampSchema.safeParse(workoutStartTime).success) {
    return limitation("Workout timing could not be verified. No recovery measurements were used.");
  }
  const sleep = data.sleep;
  if (!sleep.windowConfirmed) {
    return limitation("The Garmin sleep window is unconfirmed. No sleep measurements were used as pre-session context.");
  }
  const start = Date.parse(sleep.startAt);
  const end = Date.parse(sleep.endAt);
  const fetched = Date.parse(data.fetchedAt);
  const workout = Date.parse(workoutStartTime);
  if (end <= start || sleep.sleepSeconds > (end - start) / 1000 || fetched < end) {
    return limitation("Garmin sleep timestamps or duration are inconsistent. No sleep measurements were used.");
  }
  if (end > workout) {
    return limitation("The supplied Garmin sleep episode ended after this workout started; post-session sleep was not used as pre-session context.");
  }
  if (workout - end > MAX_SLEEP_AGE_MS) {
    return limitation("Garmin sleep data is outdated for this session: the supplied episode ended more than 24 hours before the workout. No sleep measurements were used.");
  }
  const minutes = Math.round(sleep.sleepSeconds / 60);
  const observations = [
    `Garmin-reported sleep for ${sleep.calendarDate} (Garmin-local date): ${Math.floor(minutes / 60)} h ${minutes % 60} min.`,
    `The sleep window ended ${sleep.endAt}, at or before workout start ${workoutStartTime}.`,
  ];
  if (sleep.quality) observations.push(`Garmin sleep quality label: ${sleep.quality}.`);
  const limitations = [
    "The Garmin-local sleep date is not assumed to be the workout's local date; matching uses absolute timestamps within the preceding 24 hours.",
  ];
  if (fetched > workout) {
    limitations.push(`Data was fetched after the workout started (${data.fetchedAt}). This is retrospective sleep context, not evidence that the data was available before training.`);
  }
  limitations.push("Sleep provides context only; it does not establish a cause for any performance change or constitute a medical assessment.");
  return { observations, limitations };
}
