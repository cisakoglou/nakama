import "server-only";
import { setTimeout as delay } from "node:timers/promises";
import { HevyConnectionError, storage } from "@/lib/hevy-connection";

export async function waitForHevyRequest(signal: AbortSignal) {
  signal.throwIfAborted();
  const { data, error } = await storage().rpc("reserve_hevy_request");
  if (error || !Number.isInteger(data) || data === null || data < -1 || data > 5_000) {
    console.error("Hevy request budget unavailable", { code: error?.code ?? "invalid_reservation" });
    throw new HevyConnectionError(503, "Hevy request scheduling is unavailable. Please try again.");
  }
  if (data === -1) throw new HevyConnectionError(429, "Nakama is waiting for Hevy's shared request limit. Please try again shortly.");
  if (data > 0) await delay(data, undefined, { signal });
  signal.throwIfAborted();
}
