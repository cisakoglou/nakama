"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { BrandMark } from "@/components/brand-lockup";
import { TrainingLoader } from "@/components/training-loader";
import { ConversationChat } from "@/components/conversation-chat";
import { readApiResponse } from "@/lib/api-response";
import { chatRecovery } from "@/lib/chat-recovery";
import {
  conversationListSchema, conversationResponseSchema, type Conversation, type ConversationSummary,
} from "@/lib/conversation-types";

export function ChatPanel({ onSettings, onSignOut, signingOut, accountError, userId }: {
  onSettings: () => void; onSignOut: () => void; signingOut: boolean; accountError: string | null; userId: string;
}) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [opened, setOpened] = useState(0);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const shell = useRef<HTMLElement>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      // Preserve pinch zoom; only follow the keyboard at the default scale.
      if (viewport.scale !== 1) return;
      shell.current?.style.setProperty("--chat-height", `${viewport.height}px`);
      shell.current?.style.setProperty("--chat-top", `${viewport.offsetTop}px`);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => { viewport.removeEventListener("resize", update); viewport.removeEventListener("scroll", update); };
  }, []);
  const action = useRef(false);
  const flush = useRef<() => Promise<boolean>>(async () => true);

  const list = useCallback(async (page = 0, append = false) => {
    const result = await readApiResponse(await fetch(`/api/conversations?page=${page}`, { cache: "no-store" }), conversationListSchema);
    setConversations((old) => append
      ? [...new Map([...old, ...result.conversations].map((chat) => [chat.id, chat])).values()]
      : result.conversations);
    setHasMore(result.hasMore);
    setPage(page);
    setActive((current) => current ? { ...current, title: result.conversations.find((chat) => chat.id === current.id)?.title ?? current.title } : null);
    return result.conversations;
  }, []);

  function remember(id: string | null) {
    try {
      chatRecovery(window.localStorage, userId).select(id);
      setStorageError(null);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setStorageError("This browser could not remember your open chat. Your account history is still available in Chats.");
    }
  }

  useEffect(() => {
    let disposed = false;
    async function load() {
      try {
        const rows = await list();
        if (disposed) return;
        let selected = rows[0]?.id;
        try { selected = chatRecovery(window.localStorage, userId).active() ?? selected; }
        catch (error) {
          if (!(error instanceof Error)) throw error;
          setStorageError("The last open chat could not be restored from this browser. Choose it from Chats.");
        }
        if (selected) {
          let response = await fetch(`/api/conversations/${selected}`, { cache: "no-store" });
          if (response.status === 404 && rows[0] && selected !== rows[0].id) {
            response = await fetch(`/api/conversations/${rows[0].id}`, { cache: "no-store" });
          }
          const result = await readApiResponse(response, conversationResponseSchema);
          if (!disposed) { setActive(result.conversation); remember(result.conversation.id); }
        } else setShowHistory(true);
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        if (!disposed) setError(error.message);
      } finally { if (!disposed) setLoading(false); }
    }
    void load();
    return () => { disposed = true; };
  }, [list, userId]);

  async function run(operation: () => Promise<void>) {
    if (action.current || busy) return;
    action.current = true;
    setActing(true);
    setError(null);
    try {
      if (!await flush.current()) return;
      await operation();
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setError(error.message);
    } finally { action.current = false; setActing(false); }
  }

  async function open(id: string) {
    const { conversation } = await readApiResponse(await fetch(`/api/conversations/${id}`, { cache: "no-store" }), conversationResponseSchema);
    setActive(conversation);
    setOpened((value) => value + 1);
    setShowHistory(false);
    remember(id);
  }

  async function create() {
    const { conversation } = await readApiResponse(await fetch("/api/conversations", { method: "POST" }), conversationResponseSchema);
    setActive(conversation);
    setOpened((value) => value + 1);
    setShowHistory(false);
    remember(conversation.id);
    await list();
  }

  async function rename() {
    if (!active) return;
    const title = window.prompt("Chat title", active.title);
    if (title === null) return;
    const { conversation } = await readApiResponse(await fetch(`/api/conversations/${active.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }),
    }), conversationResponseSchema);
    setActive((current) => current ? { ...current, title: conversation.title } : null);
    await list();
  }

  async function remove() {
    if (!active || !window.confirm(`Permanently delete "${active.title}" and its draft? This cannot be undone.`)) return;
    const latest = await readApiResponse(await fetch(`/api/conversations/${active.id}`, { cache: "no-store" }), conversationResponseSchema);
    await readApiResponse(await fetch(`/api/conversations/${active.id}`, {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: latest.conversation.revision }),
    }), z.object({ deleted: z.literal(true) }));
    setActive(null);
    remember(null);
    try { chatRecovery(window.localStorage, userId).clearDraft(active.id); }
    catch (error) {
      if (!(error instanceof Error)) throw error;
      setStorageError("The chat was deleted from your account, but its local draft could not be removed from this browser.");
    }
    setShowHistory(true);
    await list();
  }

  const saved = useCallback(() => {
    void list().catch((error: unknown) => {
      if (!(error instanceof Error)) throw error;
      setError(error.message);
    });
  }, [list]);
  const disabled = busy || acting || loading;

  return (
    <main ref={shell} className="chat-shell mx-auto flex h-dvh w-full max-w-5xl flex-col">
      <header className="chat-header flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3">
        <BrandMark className="brand-mark h-10 w-10" />
        <div className="mr-auto min-w-0"><h1 className="text-xl font-black tracking-tight">Nakama</h1><p className="max-w-56 truncate text-xs text-ink-muted">{active?.title ?? "Your training companion"}</p></div>
        <button onClick={() => setShowHistory((value) => !value)} aria-expanded={showHistory} className="min-h-11 text-sm underline underline-offset-4">Chats</button>
        <button onClick={() => { void run(create); }} disabled={disabled} className="min-h-11 text-sm underline underline-offset-4 disabled:opacity-50">New chat</button>
        <details className="account-menu"><summary aria-label="Account menu">•••</summary><div>
        <button onClick={() => { void run(async () => onSettings()); }} disabled={disabled} className="min-h-11 text-sm underline underline-offset-4 disabled:opacity-50">Settings</button>
        <a href="/features" target="_blank" rel="noopener noreferrer"
          className="flex min-h-11 w-full items-center rounded-[10px] px-3.5 text-left text-sm no-underline hover:bg-[var(--atlas-espresso)]">
          Features<span className="sr-only"> (opens in a new tab)</span>
        </a>
        <button onClick={() => { void run(async () => onSignOut()); }} disabled={disabled || signingOut} className="min-h-11 text-sm underline underline-offset-4 disabled:opacity-50">
          {signingOut ? "Signing out..." : "Sign out"}
        </button>
        </div></details>
      </header>
      {(error || accountError || storageError) && <p role="alert" className="shrink-0 bg-red-50 p-4 text-sm text-red-700">{error ?? accountError ?? storageError}</p>}
      {showHistory && <nav aria-label="Saved conversations" className="max-h-[45dvh] shrink-0 space-y-2 overflow-auto border-b border-line bg-surface p-4">
        <h2 className="font-semibold">Your chats</h2>
        {conversations.length === 0 && <p className="text-sm text-ink-muted">Start a new chat to save your first conversation.</p>}
        {conversations.map((chat) => <button key={chat.id} disabled={disabled} aria-current={active?.id === chat.id ? "page" : undefined}
          onClick={() => { void run(() => open(chat.id)); }}
          className="block min-h-11 w-full rounded-xl border border-line p-3 text-left text-sm aria-[current=page]:bg-brand-soft disabled:opacity-50">
          <span className="block break-words font-medium">{chat.title}</span>
          <time className="text-xs text-ink-muted" dateTime={chat.updated_at}>{new Date(chat.updated_at).toLocaleString()}</time>
        </button>)}
        {hasMore && <button disabled={disabled} onClick={() => { void run(async () => { await list(page + 1, true); }); }} className="min-h-11 text-sm underline">Load older chats</button>}
        {active && <div className="flex gap-4">
          <button disabled={disabled} onClick={() => { void run(rename); }} className="min-h-11 text-sm underline">Rename chat</button>
          <button disabled={disabled} onClick={() => { void run(remove); }} className="min-h-11 text-sm text-red-700 underline">Delete chat</button>
        </div>}
      </nav>}
      {loading ? <div className="p-6"><TrainingLoader label="Opening your training space" /></div>
        : active ? <ConversationChat key={`${active.id}:${opened}`} initial={active} userId={userId} onSaved={saved} onBusy={setBusy}
          flushRef={flush} navigating={acting} onReopen={() => { void run(() => open(active.id)); }} />
          : <div className="min-h-0 flex-1 overflow-y-auto p-6 sm:p-10"><div className="training-hero"><p className="eyebrow">Your training starts here</p><h2>Show up.<br /><span>Move forward.</span></h2><p className="hero-description">A little direction for your next big effort. Open a chat and let’s get to work.</p></div>
            <button disabled={disabled} onClick={() => { void run(create); }} className="mt-4 min-h-11 rounded-xl bg-brand px-4 font-semibold">Start a new chat</button>
            {error && <button onClick={() => { void run(async () => { await list(); }); }} className="ml-4 min-h-11 underline">Retry loading chats</button>}
          </div>}
    </main>
  );
}
