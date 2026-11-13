import { describe, expect, it } from "vitest";
import { buildRecoveryContext, type RecoverySnapshot } from "./recovery-context";

const owner = "synthetic-owner";
const workoutStart = "2026-11-13T18:00:00+01:00";
const sleep: NonNullable<RecoverySnapshot["sleep"]> = {
  calendarDate: "2026-11-13",
  startAt: "2026-11-12T23:00:00+01:00",
  endAt: "2026-11-13T06:00:00+01:00",
  sleepSeconds: 19800,
  quality: "poor",
  windowConfirmed: true,
};
const snapshot: RecoverySnapshot = {
  userId: owner,
  provider: "garmin",
  status: "available",
  fetchedAt: "2026-11-13T07:00:00+01:00",
  sleep,
};

function context(override: Partial<RecoverySnapshot> = {}, start = workoutStart) {
  return buildRecoveryContext(start, owner, { ...snapshot, ...override });
}

describe("optional pre-workout recovery context", () => {
  it("adds nothing when disconnected, not consented, or supplied another account's data", () => {
    expect(buildRecoveryContext(workoutStart, owner)).toBeUndefined();
    expect(buildRecoveryContext(workoutStart, "another-synthetic-owner", snapshot)).toBeUndefined();
  });

  it("states measured sleep rather than the whole window, attributing quality without a diagnosis", () => {
    const result = context();
    expect(result?.observations).toContain("Garmin-reported sleep for 2026-11-13 (Garmin-local date): 5 h 30 min.");
    expect(result?.observations).toContain("Garmin sleep quality label: poor.");
    expect(result?.observations.join(" ")).not.toContain("7 h");
    expect(result?.limitations.join(" ")).toContain("does not establish a cause");
    expect(JSON.stringify(result)).not.toMatch(/training readiness|body battery|overtrain|must rest|caused by/i);
  });

  it("does not classify a duration as poor quality when the provider did not supply a quality label", () => {
    const result = context({ sleep: { ...sleep, quality: undefined } });
    expect(result?.observations.join(" ")).not.toMatch(/poor|quality|readiness/i);
    expect(result?.observations.join(" ")).toContain("5 h 30 min");
  });

  it.each(["missing", "unavailable"] as const)("makes %s data explicit without using metrics left on the snapshot", (status) => {
    const result = context({ status });
    expect(result?.observations).toEqual([]);
    expect(result?.limitations.join(" ")).toContain(status === "missing" ? "missing" : "unavailable");
    expect(JSON.stringify(result)).not.toContain("5 h 30 min");
  });

  it("treats an available snapshot without sleep data as missing, not zero sleep", () => {
    const result = context({ sleep: undefined });
    expect(result?.observations).toEqual([]);
    expect(result?.limitations[0]).toContain("missing");
    expect(JSON.stringify(result)).not.toContain("0 h");
  });

  it("does not interpret an unconfirmed window", () => {
    const result = context({ sleep: { ...sleep, windowConfirmed: false } });
    expect(result?.observations).toEqual([]);
    expect(result?.limitations[0]).toContain("unconfirmed");
  });

  it("excludes sleep that ended during or after the session even if freshly fetched", () => {
    const result = context({}, "2026-11-13T05:30:00+01:00");
    expect(result?.observations).toEqual([]);
    expect(result?.limitations[0]).toContain("ended after this workout started");
  });

  it("matches the exact pre-session boundary but rejects older-than-24-hour sleep", () => {
    expect(context({}, sleep.endAt)?.observations.length).toBeGreaterThan(0);
    expect(context({}, "2026-11-14T06:00:00+01:00")?.observations.length).toBeGreaterThan(0);
    const stale = context({}, "2026-11-14T06:00:01+01:00");
    expect(stale?.observations).toEqual([]);
    expect(stale?.limitations[0]).toContain("outdated");
  });

  it("does not make old sleep fresh merely because it was fetched recently", () => {
    const result = context({
      sleep: {
        ...sleep, calendarDate: "2026-11-11",
        startAt: "2026-11-10T23:00:00+01:00", endAt: "2026-11-11T06:00:00+01:00",
      },
    });
    expect(result?.observations).toEqual([]);
    expect(result?.limitations[0]).toContain("outdated");
  });

  it("allows retrospective sleep context while separating fetch time from measurement time", () => {
    const result = context({ fetchedAt: "2026-11-13T20:00:00+01:00" });
    expect(result?.observations.join(" ")).toContain("5 h 30 min");
    expect(result?.limitations.join(" ")).toContain("retrospective sleep context");
    expect(result?.limitations.join(" ")).toContain("not evidence that the data was available before training");
  });

  it("uses absolute instants across zones without rewriting the provider-local sleep date", () => {
    const result = context({
      sleep: {
        ...sleep, calendarDate: "2026-11-12",
        startAt: "2026-11-11T23:00:00-08:00", endAt: "2026-11-12T06:00:00-08:00",
      },
      fetchedAt: "2026-11-12T07:00:00-08:00",
    }, "2026-11-13T01:00:00+09:00");
    expect(result?.observations[0]).toContain("2026-11-12 (Garmin-local date)");
    expect(result?.observations.join(" ")).not.toContain("last night");
    expect(result?.limitations.join(" ")).toContain("not assumed to be the workout's local date");
  });

  it("uses elapsed time, not wall-clock hours, across a daylight-saving transition", () => {
    const result = context({
      sleep: {
        ...sleep, calendarDate: "2026-03-29",
        startAt: "2026-03-29T00:00:00+01:00", endAt: "2026-03-29T08:00:00+02:00", sleepSeconds: 21600,
      },
      fetchedAt: "2026-03-29T09:00:00+02:00",
    }, "2026-03-29T18:00:00+02:00");
    expect(result?.observations[0]).toContain("6 h 0 min");
  });

  it.each([
    { calendarDate: "2026-02-30" },
    { startAt: "2026-11-12T23:00:00" },
    { endAt: "2026-11-13T06:00:00" },
    { sleepSeconds: -1 },
    { sleepSeconds: NaN },
    { sleepSeconds: Infinity },
  ])("excludes invalid raw values instead of inventing defaults (%j)", (invalid) => {
    const result = context({ sleep: { ...sleep, ...invalid } });
    expect(result?.observations).toEqual([]);
    expect(result?.limitations[0]).toContain("could not be validated");
  });

  it.each([
    { startAt: sleep.endAt },
    { startAt: "2026-11-13T07:00:00+01:00" },
    { sleepSeconds: 30000 },
  ])("rejects inconsistent window and measured-duration values (%j)", (invalid) => {
    const result = context({ sleep: { ...sleep, ...invalid } });
    expect(result?.observations).toEqual([]);
    expect(result?.limitations[0]).toContain("inconsistent");
  });

  it("rejects fetch times preceding the measured sleep and workout times without an offset", () => {
    expect(context({ fetchedAt: sleep.startAt })?.limitations[0]).toContain("inconsistent");
    const result = context({}, "2026-11-13T18:00:00");
    expect(result?.observations).toEqual([]);
    expect(result?.limitations[0]).toContain("timing could not be verified");
  });

  it("retains an explicitly measured zero without treating absent data as zero", () => {
    const result = context({ sleep: { ...sleep, sleepSeconds: 0, quality: undefined } });
    expect(result?.observations[0]).toContain("0 h 0 min");
    expect(result?.observations.join(" ")).not.toContain("poor");
  });
});
