"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { z } from "zod";
import { conversationBusy, restoredMessages, type Conversation } from "@/lib/conversation-types";
import { BrandMark } from "@/components/brand-lockup";
import { CoachingText } from "@/components/coaching-text";
import { ToolActivity } from "@/components/tool-activity";
import { TrainingLoader } from "@/components/training-loader";
import { useChatDraft } from "@/components/use-chat-draft";

export function ConversationChat({ initial, userId, onSaved, onBusy, flushRef, navigating, onReopen }: {
  initial: Conversation; userId: string; onSaved: () => void;
  onBusy: (busy: boolean) => void; flushRef: MutableRefObject<() => Promise<boolean>>;
  navigating: boolean;
  onReopen: () => void;
}) {
  const revision = useRef(initial.revision);
  const accepted = useRef(false);
  const submitted = useRef("");
  const cancelled = useRef(false);
  const [sending, setSending] = useState(false);
  const [recovered] = useState(initial.messages.length > 0);
  const draftRef = useRef<ReturnType<typeof useChatDraft> | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  const { messages, sendMessage, status, error, stop, addToolApprovalResponse } = useChat({
    id: initial.id,
    messages: restoredMessages(initial.messages),
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest: ({ messages }) => ({
        body: { conversationId: initial.id, revision: revision.current, draftVersion: draftRef.current?.version.current, messages },
      }),
      fetch: async (url, init) => {
        const response = await fetch(url, init);
        if (!response.ok) {
          const parsed = z.object({ error: z.string() }).safeParse(await response.json());
          throw new Error(parsed.success ? parsed.data.error : "Your Nakama could not start responding.");
        }
        const headers = z.object({
          revision: z.coerce.number().int().positive(),
          draftVersion: z.coerce.number().int().positive(),
        }).parse({ revision: response.headers.get("X-Chat-Revision"), draftVersion: response.headers.get("X-Chat-Draft-Version") });
        accepted.current = true;
        revision.current = headers.revision;
        draftRef.current?.accepted(headers.draftVersion, submitted.current !== "");
        return response;
      },
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: () => { onSaved(); },
    onError: () => {
      if (!accepted.current && submitted.current) draftRef.current?.setInput(submitted.current);
      onSaved();
    },
  });
  const busy = sending || status === "submitted" || status === "streaming";
  const draft = useChatDraft(initial, userId, busy || navigating);
  draftRef.current = draft;
  const locked = conversationBusy(initial);
  const latest = messages[messages.length - 1];
  const hasResponseText = latest?.role === "assistant" && latest.parts.some((part) => part.type === "text" && part.text.trim());
  const waitingForResponse = busy && !hasResponseText;
  useEffect(() => { onBusy(busy); return () => onBusy(false); }, [busy, onBusy]);
  useEffect(() => {
    flushRef.current = draft.flush;
    return () => { flushRef.current = async () => true; };
  }, [draft.flush, flushRef]);
  useEffect(() => {
    if (following.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages, busy]);
  useEffect(() => {
    const element = bottom.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (following.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
    });
    if (scroller.current?.firstElementChild) observer.observe(scroller.current.firstElementChild);
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => { void stop(); }, [stop]);

  async function send() {
    if (busy || navigating || locked || !draft.ready || !draft.input.trim() || messages.length >= 39) return;
    cancelled.current = false;
    setSending(true);
    try {
      if (!await draft.flush() || cancelled.current) return;
      accepted.current = false;
      submitted.current = draft.input;
      const text = draft.input.trim();
      draft.setInput("");
      following.current = true;
      setShowLatest(false);
      await sendMessage({ text });
    } finally { setSending(false); }
  }

  async function approve(id: string, approved: boolean) {
    if (busy || navigating) return;
    cancelled.current = false;
    setSending(true);
    try {
      if (!await draft.flush() || cancelled.current) return;
      accepted.current = false;
      submitted.current = "";
      await addToolApprovalResponse({ id, approved });
    } finally { setSending(false); }
  }

  return (
    <>
      <div ref={scroller} className="conversation-scroll min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6"
        onScroll={(event) => {
          const node = event.currentTarget;
          following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100;
          setShowLatest(!following.current);
        }}><div className="conversation-content space-y-6">
        {messages.length === 0 && <div className="welcome-space">
          <div className="training-hero">
            <p className="eyebrow">THE WORK IS YOURS. WE’RE IN YOUR CORNER.</p>
            <h2>A little direction.<br /><span>A stronger you.</span></h2>
            <p className="hero-description">Your workouts tell a story. Turn it into a stronger next session.</p>
            <div className="hero-orbit" aria-hidden="true"><i /><i /><i /><BrandMark className="hero-companion-mark" /></div>
            <div className="hero-bottom"><span>NAKAMA / YOUR COMPANION</span><span>IN YOUR CORNER</span></div>
          </div>
          <p className="eyebrow mb-3 mt-7">Find your starting point</p>
          <div className="starter-grid">
            {[
              ["01", "Find my momentum", "How has my training progressed over my last few sessions?"],
              ["02", "Plan my next session", "What should I aim for in my next workout?"],
              ["03", "Build something new", "Help me plan a routine around my goals and schedule."],
            ].map(([number, title, prompt]) => <button key={number} type="button"
              disabled={busy || navigating || locked || !draft.ready}
              onClick={() => { draft.setInput(prompt); document.getElementById("chat-input")?.focus(); }} className="starter-card">
              <span className="starter-number">{number} <span>↗</span></span><strong>{title}</strong><span>{prompt}</span>
            </button>)}
          </div>
        </div>}
        {messages.map((message) => <div key={message.id} className={`message-group space-y-3 ${message.role}`}>
          {message.role === "assistant" && <p className="message-author"><BrandMark className="message-author-mark" /> Nakama</p>}
          {message.parts.map((part, index) => {
            if (part.type === "text" && part.text) return (
              <div key={index} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[90%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-6 ${
                  message.role === "user" ? "user-bubble" : "assistant-bubble"
                }`}>{message.role === "assistant" ? <CoachingText text={part.text} /> : part.text}</div>
              </div>
            );
            return null;
          })}
          <ToolActivity parts={message.parts} busy={busy && message.id === latest?.id} disabled={busy || navigating}
            onApprove={(id, approved) => { void approve(id, approved); }} />
        </div>)}
        {waitingForResponse && <TrainingLoader responding label="Getting into your question" />}
        {busy && hasResponseText && <p role="status" className="text-xs text-ink-muted">Response in progress<span className="stream-dot" aria-hidden="true"> ●</span></p>}
        {locked && <div role="status" className="text-sm text-ink-muted">
          <p>This chat is still responding elsewhere. Reopen it shortly to load the latest saved text.</p>
          <button disabled={navigating} onClick={onReopen} className="mt-2 min-h-11 underline">Reload saved chat</button>
        </div>}
        {!locked && initial.status !== "ready" && <p role="status" className="text-sm text-ink-muted">
          The previous response was interrupted. Check Hevy before repeating a change; actions are not automatically retried.
        </p>}
        {recovered && <p className="text-xs text-ink-muted">Restored conversation text. Previous tool results and approvals are not restored or replayed.</p>}
        {(error || draft.error || draft.storageError) && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p>{error?.message ?? draft.error ?? draft.storageError}</p>
          {error && <button disabled={busy || navigating} onClick={onReopen} className="mt-2 mr-4 min-h-11 underline">Reload saved chat</button>}
          {(draft.error || draft.recoveryBlocked) && <button disabled={busy || navigating || draft.saving}
            onClick={() => { void draft.useSaved(); }} className="mt-2 min-h-11 underline">Use saved draft</button>}
        </div>}
        <div ref={bottom} />
      </div></div>
      {showLatest && <div className="latest-bar"><button onClick={() => {
        following.current = true; setShowLatest(false);
        if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
      }}>↓ Back to latest</button></div>}
      <footer className="chat-composer shrink-0 border-t border-line bg-surface px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
        <form onSubmit={(event) => { event.preventDefault(); void send(); }} className="flex items-end gap-3">
          <label htmlFor="chat-input" className="sr-only">Message your Nakama</label>
          <textarea id="chat-input" value={draft.input} onChange={(event) => draft.setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault(); event.currentTarget.form?.requestSubmit();
              }
            }}
            rows={2} maxLength={8000} disabled={busy || navigating || locked || !draft.ready || messages.length >= 39}
            placeholder="What’s your next move?"
            className="min-w-0 flex-1 resize-none rounded-xl border border-line bg-canvas px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand/40 disabled:opacity-50"
          />
          <button type="submit" disabled={busy || navigating || locked || !draft.ready || !draft.input.trim() || messages.length >= 39}
            className="min-h-12 rounded-xl bg-brand px-4 text-sm font-semibold disabled:opacity-50" aria-label="Send message">↑</button>
        </form>
        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-ink-muted">
          <p>{draft.saving ? "Saving draft..." : "Conversations are private to your account."}</p>
          {busy && <button onClick={() => { cancelled.current = true; void stop(); }} className="min-h-11 shrink-0 underline">Stop response</button>}
        </div>
        {messages.length >= 39 && <p className="mt-2 text-sm text-ink-muted">This conversation is full. Start a new chat to continue with your Nakama.</p>}
      </footer>
    </>
  );
}
