"use client";

import { useChat } from "ai/react";
import Image from "next/image";
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
      <main className="flex min-h-dvh items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">
          <Image
            src="/brand/nakama-wordmark.webp"
            alt="Nakama"
            width={900}
            height={180}
            sizes="288px"
            priority
            className="mx-auto mb-9 h-auto w-72 max-w-full"
          />
          <form
            onSubmit={(e) => { e.preventDefault(); setAuthed(true); setPwError(false); }}
            className="rounded-3xl border border-line bg-surface p-7 shadow-[0_20px_60px_-25px_rgba(52,52,45,0.22)] sm:p-8"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">
              Your training companion
            </p>
            <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight">
              A stronger next session.
            </h1>
            <p className="mt-3 text-sm leading-6 text-ink-muted">
              Turn your Hevy workouts into clear next steps, one conversation at a time.
            </p>
            <label htmlFor="app-password" className="mb-2 mt-7 block text-sm font-medium">
              App password
            </label>
            <input
              id="app-password"
              type="password"
              autoComplete="current-password"
              placeholder="Enter your app password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              aria-invalid={pwError}
              aria-describedby={pwError ? "password-error" : undefined}
              className="w-full rounded-xl border border-line bg-canvas px-4 py-3 text-base text-ink placeholder:text-ink-muted focus:border-ink/40 focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
            {pwError && (
              <p id="password-error" role="alert" className="mt-2 text-sm text-red-700">
                Incorrect password
              </p>
            )}
            <button
              type="submit"
              disabled={!password}
              className="mt-4 w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-ink transition-colors hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              Open Nakama
            </button>
          </form>
          <p className="mt-6 text-center text-xs text-ink-muted">
            Your workouts. Your next step.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex h-dvh w-full max-w-3xl flex-col sm:border-x sm:border-line">
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-4 py-4 sm:px-6">
        <Image
          src="/brand/nakama-mark.webp"
          alt=""
          width={320}
          height={320}
          sizes="48px"
          className="h-12 w-12 shrink-0"
        />
        <div>
          <p className="text-lg font-semibold tracking-tight">Nakama</p>
          <p className="text-xs text-ink-muted">Your training companion</p>
        </div>
        <span className="ml-auto hidden rounded-full border border-line bg-canvas px-3 py-1.5 text-xs text-ink-muted sm:inline-flex">
          Hevy + Claude
        </span>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-6 sm:px-6">
        {messages.length === 0 && (
          <div className="mx-auto max-w-md py-8 text-center sm:py-14">
            <Image
              src="/brand/nakama-mark.webp"
              alt=""
              width={320}
              height={320}
              sizes="96px"
              className="mx-auto mb-5 h-24 w-24"
            />
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">
              A little direction. More progress.
            </p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              What are we working on today?
            </h1>
            <p className="mt-3 text-sm leading-6 text-ink-muted">
              Review your progress, plan your next session, or build a routine around how you feel.
            </p>
            <p className="mt-6 rounded-2xl border border-line bg-surface px-5 py-4 text-sm leading-6 text-ink-muted">
              Try asking: &ldquo;What should I aim for on bench press next time?&rdquo;
            </p>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id}>
            {m.parts
              ?.filter((p) => p.type === "tool-invocation")
              .map((p, i) => {
                if (p.type !== "tool-invocation") return null;
                const label = TOOL_LABELS[p.toolInvocation.toolName] ?? `${p.toolInvocation.toolName}…`;
                const done = p.toolInvocation.state === "result";
                return (
                  <div
                    key={i}
                    className="mb-2 ml-1 flex items-center gap-2 text-xs text-ink-muted"
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${done ? "bg-brand" : "animate-pulse bg-ink/30"}`} />
                    {label}
                  </div>
                );
              })}

            {m.content && (
              <div className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "rounded-br-sm bg-brand-soft font-medium text-ink"
                      : "rounded-bl-sm border border-line bg-surface text-ink shadow-sm"
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
            <div className="rounded-2xl rounded-bl-sm border border-line bg-surface px-4 py-3">
              <span className="flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-muted [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-muted [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-muted [animation-delay:300ms]" />
              </span>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-center text-sm text-red-700">
            {error.message}
          </p>
        )}

        <div ref={bottomRef} />
      </div>

      <footer className="shrink-0 border-t border-line bg-surface px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-6">
        <form onSubmit={handleSubmit} className="flex items-end gap-3">
          <label htmlFor="chat-input" className="sr-only">Message your training companion</label>
          <textarea
            id="chat-input"
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={onKeyDown}
            placeholder="Ask your training companion…"
            rows={1}
            disabled={isLoading}
            className="min-w-0 flex-1 resize-none rounded-xl border border-line bg-canvas px-4 py-3 text-base leading-6 text-ink transition-colors placeholder:text-ink-muted focus:border-ink/40 focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-50"
            style={{ minHeight: "48px", maxHeight: "120px" }}
          />
          <button
            type="submit"
            aria-label="Send message"
            disabled={isLoading || !input.trim()}
            className="flex h-[50px] w-12 shrink-0 items-center justify-center rounded-xl bg-brand text-xl font-semibold text-ink transition-colors hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            ↑
          </button>
        </form>
        <p className="mt-3 text-center text-xs text-ink-muted">Enter to send · Shift+Enter for a new line</p>
      </footer>
    </main>
  );
}
