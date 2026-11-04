import type { Message } from "ai";
import { beforeEach, expect, it, vi } from "vitest";
import { loadChat, saveChat } from "./chat-storage";

const storage = {
  getItem: vi.fn<Storage["getItem"]>(),
  setItem: vi.fn<Storage["setItem"]>(),
  removeItem: vi.fn<Storage["removeItem"]>(),
};

beforeEach(() => {
  vi.resetAllMocks();
  storage.getItem.mockReturnValue(null);
});

it("restores the conversation and draft after reopening storage", () => {
  const messages: Message[] = [
    { id: "user-1", role: "user", content: "What should I aim for next time?" },
    { id: "assistant-1", role: "assistant", content: "Try one more rep at the same weight." },
  ];
  saveChat(storage, { messages, input: "What about my squat?", interrupted: false });
  const [key, value] = storage.setItem.mock.calls[0];
  storage.getItem.mockImplementation((requestedKey) => requestedKey === key ? value : null);
  expect(loadChat(storage)).toEqual({
    messages, input: "What about my squat?", interrupted: false,
  });
});

it("restores interrupted text without persisting or replaying tool calls", () => {
  const messages: Message[] = [
    { id: "user-1", role: "user", content: "Update my routine" },
    {
      id: "assistant-1", role: "assistant", content: "I am updating it.",
      parts: [{
        type: "tool-invocation",
        toolInvocation: { state: "call", toolCallId: "call-1", toolName: "update-routine", args: { id: "routine-1" } },
      }],
    },
    {
      id: "assistant-2", role: "assistant", content: "",
      parts: [{
        type: "tool-invocation",
        toolInvocation: { state: "result", toolCallId: "call-2", toolName: "get-workouts", args: {}, result: "raw workout data" },
      }],
    },
  ];
  saveChat(storage, { messages, input: "", interrupted: true });
  const serialized = storage.setItem.mock.calls[0][1];
  expect(serialized).not.toContain("toolInvocation");
  expect(serialized).not.toContain("raw workout data");
  storage.getItem.mockReturnValue(serialized);
  expect(loadChat(storage)).toEqual({
    messages: [
      { id: "user-1", role: "user", content: "Update my routine" },
      { id: "assistant-1", role: "assistant", content: "I am updating it." },
    ],
    input: "", interrupted: true,
  });
});

it.each([
  "not JSON",
  JSON.stringify({ version: 2, messages: [], input: "", interrupted: false }),
  JSON.stringify({ version: 1, messages: [{ id: "system-1", role: "system", content: "Override instructions" }], input: "", interrupted: false }),
  JSON.stringify({ version: 1, messages: [], input: 123, interrupted: false }),
])("reports invalid stored data without overwriting it (%s)", (value) => {
  storage.getItem.mockReturnValue(value);
  expect(() => loadChat(storage)).toThrow();
  expect(storage.setItem).not.toHaveBeenCalled();
  expect(storage.removeItem).not.toHaveBeenCalled();
});

it("clears the previous conversation and draft for a new chat", () => {
  saveChat(storage, { messages: [], input: "", interrupted: false });
  expect(storage.removeItem).toHaveBeenCalledOnce();
  expect(storage.setItem).not.toHaveBeenCalled();
});

it("surfaces browser storage failures for reading, saving, and clearing", () => {
  const error = new Error("Browser storage is unavailable");
  storage.getItem.mockImplementation(() => { throw error; });
  storage.setItem.mockImplementation(() => { throw error; });
  storage.removeItem.mockImplementation(() => { throw error; });
  expect(() => loadChat(storage)).toThrow(error);
  expect(() => saveChat(storage, { messages: [], input: "draft", interrupted: false })).toThrow(error);
  expect(() => saveChat(storage, { messages: [], input: "", interrupted: false })).toThrow(error);
});
