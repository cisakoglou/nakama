export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { startWorkoutReportWorker } = await import("@/lib/workout-report-worker");
  startWorkoutReportWorker();
}
