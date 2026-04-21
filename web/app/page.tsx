"use client";

import { useChat } from "ai/react";
import { useEffect, useRef, useState } from "react";

const TOOL_LABELS: Record<string, string> = {
  "get-workouts": "Fetching workouts…",
  "get-workout": "Loading workout…",
  "get-workout-count": "Counting workouts…",
  "search-exercise-templates": "Searching exercises…",
  "get-exercise-templates": "Loading exercises…",
  "get-exercise-history": "Fetching exercise history…",
  "get-routines": "Loading routines…",
  "get-routine": "Loading routine…",
  "create-routine": "Creating routine…",
  "update-routine": "Updating routine…",
  "create-workout": "Logging workout…",
};

export default function Home() {
  const [password, setPassword] = useState("");
  const [authed, setAuthed] = useState(false);
  const [pwError, setPwError] = useState(false);

  const { messages, input, handleInputChange, handleSubmit, isLoading, error } = useChat({
    headers: { "x-app-password": password },
    onError: (e) => { if (e.message.includes("401")) { setAuthed(false); setPwError(true); } },
  });
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent<HTMLFormElement>);
    }
  };

  if (!authed) {
    return (
      <div className="flex items-center justify-center h-screen">
        <form
          onSubmit={(e) => { e.preventDefault(); setAuthed(true); setPwError(false); }}
          className="flex flex-col items-center gap-4 w-72"
        >
          <div className="w-12 h-12 rounded-full bg-brand flex items-center justify-center text-black font-bold text-xl">N</div>
          <p className="font-semibold text-white">Nakama</p>
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            className="w-full rounded-xl px-4 py-3 text-sm border border-white/10 focus:outline-none focus:border-brand/50"
            style={{ background: "#1a1a1a", color: "#e5e5e5" }}
          />
          {pwError && <p className="text-red-400 text-xs">Incorrect password</p>}
          <button
            type="submit"
            disabled={!password}
            className="w-full rounded-xl bg-brand text-black font-semibold py-3 text-sm disabled:opacity-30 hover:bg-green-400 transition-colors"
          >
            Enter
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-white/10">
        <div className="w-8 h-8 rounded-full bg-brand flex items-center justify-center text-black font-bold text-sm">
          T
        </div>
        <div>
          <p className="font-semibold text-sm">Nakama</p>
          <p className="text-xs text-white/40">Powered by Hevy + Claude</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-white/30 text-sm mt-16 space-y-2">
            <p className="text-2xl">🏋️</p>
            <p>Ask me about your progress, plan your next session,</p>
            <p>or create a routine tailored to how you feel today.</p>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id}>
            {/* Tool calls */}
            {m.parts
              ?.filter((p) => p.type === "tool-invocation")
              .map((p, i) => {
                if (p.type !== "tool-invocation") return null;
                const label = TOOL_LABELS[p.toolInvocation.toolName] ?? `${p.toolInvocation.toolName}…`;
                const done = p.toolInvocation.state === "result";
                return (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-xs text-white/30 mb-1 ml-1"
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${done ? "bg-brand" : "bg-white/20 animate-pulse"}`} />
                    {label}
                  </div>
                );
              })}

            {/* Text content */}
            {m.content && (
              <div className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-brand text-black font-medium rounded-br-sm"
                      : "bg-white/8 text-white/90 rounded-bl-sm"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            )}
          </div>
        ))}

        {isLoading && messages[messages.length - 1]?.role === "user" && (
          <div className="flex justify-start">
            <div className="bg-white/8 rounded-2xl rounded-bl-sm px-4 py-3">
              <span className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-white/30 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-white/30 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-white/30 rounded-full animate-bounce [animation-delay:300ms]" />
              </span>
            </div>
          </div>
        )}

        {error && (
          <p className="text-red-400 text-xs text-center">{error.message}</p>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-4 border-t border-white/10">
        <form onSubmit={handleSubmit} className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={onKeyDown}
            placeholder="Ask your trainer…"
            rows={1}
            disabled={isLoading}
            className="flex-1 border border-white/10 rounded-xl px-4 py-3 text-sm placeholder-white/30 resize-none focus:outline-none focus:border-brand/50 disabled:opacity-50 transition-colors"
            style={{ background: "#1a1a1a", color: "#e5e5e5", minHeight: "48px", maxHeight: "120px" }}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="w-10 h-10 rounded-xl bg-brand text-black font-bold text-lg flex items-center justify-center disabled:opacity-30 hover:bg-green-400 transition-colors flex-shrink-0"
          >
            ↑
          </button>
        </form>
        <p className="text-white/20 text-xs text-center mt-2">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}
