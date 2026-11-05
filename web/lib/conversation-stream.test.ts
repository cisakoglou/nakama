import { expect, it, vi } from "vitest";
import { conversationWriter } from "./conversation-stream";

it("checkpoints partial text and finalizes an interrupted response exactly once", async () => {
  const checkpoint = vi.fn().mockResolvedValue(undefined);
  const writer = conversationWriter({ checkpoint }, "chat", "run",
    [{ id: "user", role: "user", content: "Plan my session" }], "assistant");
  await writer.append("Try ");
  await writer.append("one more rep.");
  await Promise.all([writer.finish(undefined, true), writer.finish(undefined, false)]);
  expect(checkpoint).toHaveBeenLastCalledWith("chat", "run", [
    { id: "user", role: "user", content: "Plan my session" },
    { id: "assistant", role: "assistant", content: "Try one more rep." },
  ], "interrupted");
  expect(checkpoint.mock.calls.filter((call) => call[3] !== "streaming")).toHaveLength(1);
});

it("persists the authoritative finished text and never the tool output", async () => {
  const checkpoint = vi.fn().mockResolvedValue(undefined);
  const writer = conversationWriter({ checkpoint }, "chat", "run", [], "assistant");
  await writer.finish([{
    id: "assistant", role: "assistant", parts: [
      { type: "text", text: "Your routine is updated." },
      { type: "dynamic-tool", toolName: "update-routine", toolCallId: "call", state: "output-available", input: {}, output: "raw private output" },
    ],
  }], false);
  expect(checkpoint).toHaveBeenCalledWith("chat", "run", [
    { id: "assistant", role: "assistant", content: "Your routine is updated." },
  ], "ready");
});

it("does not claim persistence succeeded when a checkpoint fails", async () => {
  const checkpoint = vi.fn().mockRejectedValue(new Error("Database unavailable"));
  const writer = conversationWriter({ checkpoint }, "chat", "run", [], "assistant");
  await expect(writer.append("Partial response")).rejects.toThrow("Database unavailable");
  await expect(writer.finish(undefined, true)).rejects.toThrow("Database unavailable");
});
