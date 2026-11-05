import { HevyConnectionError } from "@/lib/hevy-connection";

const active = new Map<string, Set<AbortController>>();

export function registerChat(userId: string) {
  if (active.has(userId) || active.size >= 20) {
    throw new HevyConnectionError(429, "Your Nakama is already responding. Let it finish or try again shortly.");
  }
  const controller = new AbortController();
  const sessions = new Set([controller]);
  active.set(userId, sessions);
  return {
    controller,
    release() {
      sessions.delete(controller);
      if (sessions.size === 0 && active.get(userId) === sessions) active.delete(userId);
    },
  };
}

export function disconnectChats(userId: string) {
  const sessions = active.get(userId);
  if (!sessions) return;
  for (const controller of sessions) controller.abort();
}
