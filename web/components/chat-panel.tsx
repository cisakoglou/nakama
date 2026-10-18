"use client";

import Image from "next/image";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, getToolName, isToolUIPart, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

export function ChatPanel({ onSettings, onSignOut, signingOut, accountError }: {
  onSettings: () => void; onSignOut: () => void; signingOut: boolean; accountError: string | null;
}) {
  const [id] = useState(() => crypto.randomUUID());
  const [input, setInput] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const { messages, sendMessage, status, error, stop, setMessages, clearError, addToolApprovalResponse } = useChat({
    id,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest: ({ messages }) => ({ body: { messages } }),
      fetch: async (url, init) => {
        const response = await fetch(url, init);
        if (!response.ok) {
          const parsed = z.object({ error: z.string() }).safeParse(await response.json());
          throw new Error(parsed.success ? parsed.data.error : "Coaching could not be started.");
        }
        return response;
      },
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });
  const busy = status === "submitted" || status === "streaming";
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => () => { void stop(); }, [stop]);

  return (
    <main className="mx-auto flex h-dvh w-full max-w-3xl flex-col sm:border-x sm:border-line">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3">
        <Image src="/brand/nakama-mark.webp" alt="" width={48} height={48} className="h-12 w-12" />
        <div className="mr-auto"><h1 className="font-semibold">Nakama</h1><p className="text-xs text-ink-muted">Your training companion</p></div>
        <button onClick={onSettings} className="min-h-11 text-sm underline underline-offset-4">Settings</button>
        <button onClick={onSignOut} disabled={signingOut} className="min-h-11 text-sm underline underline-offset-4 disabled:opacity-50">
          {signingOut ? "Signing out..." : "Sign out"}
        </button>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-6 sm:px-6">
        {messages.length === 0 && (
          <div className="mx-auto max-w-md py-10 text-center">
            <h2 className="text-2xl font-semibold">What are we working on today?</h2>
            <p className="mt-3 text-sm leading-6 text-ink-muted">
              Ask about your progress, plan your next session, or build a routine using your own Hevy workouts.
            </p>
          </div>
        )}
        {messages.map((message) => (
          <div key={message.id} className="space-y-3">
            {message.parts.map((part, index) => {
              if (part.type === "text" && part.text) {
                return (
                  <div key={index} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[90%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-6 ${
                      message.role === "user" ? "bg-brand-soft" : "border border-line bg-surface"
                    }`}>{part.text}</div>
                  </div>
                );
              }
              if (!isToolUIPart(part)) return null;
              const name = getToolName(part);
              return (
                <div key={index} className="rounded-xl border border-line p-4 text-sm">
                  <p className="font-medium">{name}</p>
                  {part.state === "approval-requested" ? (
                    <>
                      <p className="mt-2">Approve this change to your Hevy account?</p>
                      <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(part.input, null, 2)}</pre>
                      <div className="mt-3 flex gap-3">
                        <button
                          disabled={busy} className="min-h-11 rounded-lg bg-brand px-4 font-semibold"
                          onClick={() => { void addToolApprovalResponse({ id: part.approval.id, approved: true }); }}
                        >Approve</button>
                        <button
                          disabled={busy} className="min-h-11 rounded-lg border border-line px-4"
                          onClick={() => { void addToolApprovalResponse({ id: part.approval.id, approved: false }); }}
                        >Decline</button>
                      </div>
                    </>
                  ) : (
                    <p className="mt-1 text-ink-muted">
                      {part.state === "output-error" ? "Hevy request failed. Check the connection before retrying."
                        : part.state === "output-denied" ? "Change declined."
                          : part.state === "output-available" ? "Complete." : "Working..."}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {busy && <p role="status" className="text-sm text-ink-muted">Working with your Hevy data...</p>}
        {(error || accountError) && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error?.message ?? accountError}</p>}
        <div ref={bottom} />
      </div>
      <footer className="shrink-0 border-t border-line bg-surface px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
        <form onSubmit={(event) => {
          event.preventDefault();
          if (busy || !input.trim()) return;
          void sendMessage({ text: input.trim() });
          setInput("");
        }} className="flex items-end gap-3">
          <label htmlFor="chat-input" className="sr-only">Message your training companion</label>
          <textarea
            id="chat-input" value={input} onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            rows={2} maxLength={8000} disabled={busy || messages.length >= 40}
            placeholder="Ask about your training..."
            className="min-w-0 flex-1 resize-none rounded-xl border border-line bg-canvas px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand/40 disabled:opacity-50"
          />
          <button type="submit" disabled={busy || !input.trim() || messages.length >= 40} className="min-h-12 rounded-xl bg-brand px-4 text-sm font-semibold disabled:opacity-50">Send</button>
        </form>
        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-ink-muted">
          <p>Chat is not saved. Verify advice against how you feel.</p>
          {busy ? <button onClick={() => { void stop(); }} className="min-h-11 shrink-0 underline">Stop response</button> : (
            <button onClick={() => { setMessages([]); clearError(); }} className="min-h-11 shrink-0 underline">New chat</button>
          )}
        </div>
      </footer>
    </main>
  );
}
