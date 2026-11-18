"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { BrandMark } from "@/components/brand-lockup";
import { ChatActionDialog } from "@/components/chat-action-dialog";
import { ChatIcon } from "@/components/chat-icon";
import { ChatSearchTitle } from "@/components/chat-search-title";
import { useChatSearch } from "@/components/use-chat-search";
import { TrainingLoader } from "@/components/training-loader";
import { ConversationChat } from "@/components/conversation-chat";
import { readApiResponse } from "@/lib/api-response";
import { chatRecovery } from "@/lib/chat-recovery";
import {
  chatDeepLink, isWorkoutReport, latestCreatedAt, LIST_REFRESH_INTERVAL_MS, mergeLatest, newReportIds, reportsSeenStore,
  withoutChatParam,
} from "@/lib/report-notices";
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
  const [chatAction, setChatAction] = useState<{ kind: "rename" | "delete"; chat: Pick<Conversation, "id" | "title"> } | null>(null);
  const search = useChatSearch();
  const searchInput = useRef<HTMLInputElement>(null);
  const historyToggle = useRef<HTMLButtonElement>(null);
  const historyPanel = useRef<HTMLElement>(null);
  const accountMenu = useRef<HTMLDetailsElement>(null);
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
  const [seenAt, setSeenAt] = useState<string | null>(null);
  const seenRef = useRef<string | null>(null);
  const lastRefresh = useRef(0);
  const openFromNotification = useRef<(id: string) => void>(() => {});

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!historyPanel.current?.contains(event.target) && !historyToggle.current?.contains(event.target)) setShowHistory(false);
      if (accountMenu.current && !accountMenu.current.contains(event.target)) accountMenu.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (accountMenu.current?.open) {
        accountMenu.current.open = false;
        accountMenu.current.querySelector("summary")?.focus();
      } else if (showHistory) {
        setShowHistory(false);
        historyToggle.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [showHistory]);

  function closeMenus() {
    setShowHistory(false);
    if (accountMenu.current) accountMenu.current.open = false;
  }

  function editChat(kind: "rename" | "delete") {
    if (!active) return;
    setError(null);
    setChatAction({ kind, chat: { id: active.id, title: active.title } });
    closeMenus();
  }

  // Advances the per-account "seen" mark for report chats; never moves it backwards.
  const markSeen = useCallback((mark: string | null) => {
    if (!mark || (seenRef.current && Date.parse(seenRef.current) >= Date.parse(mark))) return;
    seenRef.current = mark;
    setSeenAt(mark);
    try { reportsSeenStore(window.localStorage, userId).set(mark); }
    catch (error) { if (!(error instanceof Error)) throw error; }
  }, [userId]);

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
        const link = chatDeepLink(window.location.search);
        if (link) window.history.replaceState(window.history.state, "", withoutChatParam(window.location.href));
        const rows = await list();
        if (disposed) return;
        let stored: string | null = null;
        try { stored = reportsSeenStore(window.localStorage, userId).get(); }
        catch (error) { if (!(error instanceof Error)) throw error; }
        // First visit on this device: existing reports count as seen.
        if (stored) { seenRef.current = stored; setSeenAt(stored); }
        else markSeen(latestCreatedAt(rows, null) ?? new Date().toISOString());
        lastRefresh.current = Date.now();
        let selected = rows[0]?.id;
        try { selected = chatRecovery(window.localStorage, userId).active() ?? selected; }
        catch (error) {
          if (!(error instanceof Error)) throw error;
          setStorageError("The last open chat could not be restored from this browser. Choose it from Chats.");
        }
        selected = link ?? selected;
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
  }, [list, markSeen, userId]);

  // Picks up reports delivered while the tab was in the background, without dropping older loaded pages.
  const refresh = useCallback(async (force = false) => {
    if (!force && (document.visibilityState !== "visible" || Date.now() - lastRefresh.current < LIST_REFRESH_INTERVAL_MS)) return;
    lastRefresh.current = Date.now();
    try {
      const result = await readApiResponse(await fetch("/api/conversations?page=0", { cache: "no-store" }), conversationListSchema);
      setConversations((old) => mergeLatest(result.conversations, old));
    } catch (error) {
      if (!(error instanceof Error)) throw error; // Background refresh; the list stays as it was.
    }
  }, []);
  useEffect(() => {
    const onVisible = () => { void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const onMessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (typeof data !== "object" || data === null || (data as { type?: unknown }).type !== "nakama:open-chat") return;
      const id = chatDeepLink(`?chat=${String((data as { conversationId?: unknown }).conversationId ?? "")}`);
      if (!id) return;
      void refresh(true);
      openFromNotification.current(id);
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, [refresh]);

  // Opening a report counts as seeing it (and any older report).
  useEffect(() => {
    if (active && isWorkoutReport(active)) markSeen(active.created_at);
  }, [active, markSeen]);

  // Closing the Chats list counts as having seen everything it showed.
  const wasShowingHistory = useRef(false);
  useEffect(() => {
    if (wasShowingHistory.current && !showHistory && !search.term) markSeen(latestCreatedAt(conversations, null));
    wasShowingHistory.current = showHistory && !search.term;
  }, [showHistory, conversations, markSeen, search.term]);

  async function run(operation: () => Promise<void>) {
    if (action.current || busy) return;
    action.current = true;
    setActing(true);
    setError(null);
    try {
      if (!await flush.current()) {
        setError("Your draft could not be saved. Resolve the draft warning and try again.");
        return;
      }
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
    search.reload();
  }

  async function rename(chat: Pick<Conversation, "id" | "title">, title: string) {
    const { conversation } = await readApiResponse(await fetch(`/api/conversations/${chat.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }),
    }), conversationResponseSchema);
    setActive((current) => current?.id === chat.id ? { ...current, title: conversation.title } : current);
    setChatAction(null);
    await list();
    search.reload();
  }

  async function remove(chat: Pick<Conversation, "id" | "title">) {
    const latest = await readApiResponse(await fetch(`/api/conversations/${chat.id}`, { cache: "no-store" }), conversationResponseSchema);
    await readApiResponse(await fetch(`/api/conversations/${chat.id}`, {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: latest.conversation.revision }),
    }), z.object({ deleted: z.literal(true) }));
    setActive((current) => current?.id === chat.id ? null : current);
    if (active?.id === chat.id) remember(null);
    setChatAction(null);
    try { chatRecovery(window.localStorage, userId).clearDraft(chat.id); }
    catch (error) {
      if (!(error instanceof Error)) throw error;
      setStorageError("The chat was deleted from your account, but its local draft could not be removed from this browser.");
    }
    setShowHistory(true);
    await list();
    search.reload();
  }

  const saved = useCallback(() => {
    search.reload();
    void list().catch((error: unknown) => {
      if (!(error instanceof Error)) throw error;
      setError(error.message);
    });
  }, [list, search.reload]);
  const disabled = busy || acting || loading;
  openFromNotification.current = (id) => { void run(() => open(id)); };
  const newReports = newReportIds(conversations, seenAt, active?.id ?? null);
  const latestReport = conversations.find((chat) => newReports.has(chat.id));
  const history = search.term ? search.conversations : conversations;
  const historyHasMore = search.term ? search.hasMore : hasMore;

  return (
    <main ref={shell} className="chat-shell mx-auto flex h-dvh w-full max-w-5xl flex-col">
      <header className="chat-header flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3">
        <BrandMark className="brand-mark h-10 w-10" />
        <div className="mr-auto min-w-0"><h1 className="text-xl font-black tracking-tight">Nakama</h1><p className="max-w-56 truncate text-xs text-ink-muted">{active?.title ?? "Your training companion"}</p></div>
        <button ref={historyToggle} onClick={() => {
          if (accountMenu.current) accountMenu.current.open = false;
          setShowHistory((value) => !value);
        }} aria-expanded={showHistory} aria-controls="chat-history" className="chat-history-toggle min-h-11">
          Chats{newReports.size > 0 && <span className="ml-1 rounded-full bg-brand px-1.5 py-0.5 text-xs font-semibold text-canvas no-underline">
            {newReports.size}<span className="sr-only"> new workout {newReports.size === 1 ? "report" : "reports"}</span></span>}
          <ChatIcon name="chevron" />
        </button>
        <button onClick={() => { closeMenus(); void run(create); }} disabled={disabled} className="chat-new-button min-h-11 disabled:opacity-50"><ChatIcon name="plus" />New chat</button>
        <details ref={accountMenu} className="account-menu" onToggle={(event) => {
          if (event.currentTarget.open) setShowHistory(false);
        }}><summary aria-label="Account menu"><ChatIcon name="dots" /></summary><div>
          <button onClick={() => { closeMenus(); void run(async () => onSettings()); }} disabled={disabled} className="disabled:opacity-50"><ChatIcon name="settings" />Settings</button>
          <a href="/features" target="_blank" rel="noopener noreferrer" onClick={closeMenus}>
            <ChatIcon name="features" />Features<span className="sr-only"> (opens in a new tab)</span>
          </a>
          <button onClick={() => { closeMenus(); void run(async () => onSignOut()); }} disabled={disabled || signingOut} className="disabled:opacity-50">
            <ChatIcon name="logout" />{signingOut ? "Signing out..." : "Sign out"}
          </button>
        </div></details>
        {showHistory && <nav ref={historyPanel} id="chat-history" aria-label="Saved conversations" className="chat-history-popover">
          <div className="chat-history-heading"><h2>Your chats</h2><span>{conversations.length} {hasMore ? "recent " : ""}{conversations.length === 1 ? "conversation" : "conversations"}</span></div>
          <div className="chat-history-search">
            <ChatIcon name="search" />
            <input ref={searchInput} type="search" aria-label="Search chat names" placeholder="Search chat names"
              maxLength={80} value={search.query} onChange={(event) => search.setQuery(event.target.value)} />
            {search.query && <button aria-label="Clear search" onClick={() => { search.setQuery(""); searchInput.current?.focus(); }}><ChatIcon name="close" /></button>}
          </div>
          {search.term && <p className="chat-search-status" role="status">{search.loading ? "Searching..." : search.error
            ? "Search could not be loaded." : `${history.length}${historyHasMore ? "+" : ""} ${history.length === 1 ? "result" : "results"}`}</p>}
          <div className="chat-history-list" aria-busy={Boolean(search.term) && search.loading}>
            {search.term && search.error && <div className="chat-history-empty" role="alert">{search.error}<button className="chat-history-more" onClick={search.retry} disabled={search.loading}>Retry search</button></div>}
            {history.length === 0 && !search.term && <p className="chat-history-empty">Start a new chat to save your first conversation.</p>}
            {history.length === 0 && search.term && !search.loading && !search.error && <div className="chat-search-empty">
              <ChatIcon name="search" /><h3>No chats found.</h3><p>Try a different chat name, or clear your search to see them all.</p>
              <button onClick={() => { search.setQuery(""); searchInput.current?.focus(); }}>Clear search</button>
            </div>}
            {history.map((chat) => <button key={chat.id} disabled={disabled || (Boolean(search.term) && search.loading)} aria-current={active?.id === chat.id ? "page" : undefined}
              onClick={() => { void run(() => open(chat.id)); }} className="chat-history-row">
              <span className="chat-history-icon"><ChatIcon name="chat" /></span>
              <span className="chat-history-copy">
                <span className="chat-history-title"><ChatSearchTitle title={chat.title} query={search.term} />{newReports.has(chat.id) && <span className="chat-history-new">New</span>}</span>
                <time dateTime={chat.updated_at}>{new Date(chat.updated_at).toLocaleString()}</time>
              </span>
              {active?.id === chat.id && <ChatIcon name="check" />}
            </button>)}
            {historyHasMore && !search.error && <button disabled={disabled || search.loading} onClick={() => {
              if (search.term) search.loadMore();
              else void run(async () => { await list(page + 1, true); });
            }} className="chat-history-more">{search.term ? search.loading ? "Loading..." : "Load more matches" : "Load older chats"}</button>}
          </div>
          {active && <div className="chat-history-footer">
            <p>For the open chat</p>
            <div className="chat-history-actions">
              <button disabled={disabled} onClick={() => editChat("rename")}><ChatIcon name="pencil" />Rename chat</button>
              <button disabled={disabled} onClick={() => editChat("delete")} className="is-danger"><ChatIcon name="trash" />Delete chat</button>
            </div>
          </div>}
        </nav>}
      </header>
      {(error || accountError || storageError) && <p role="alert" className="shrink-0 bg-red-50 p-4 text-sm text-red-700">{error ?? accountError ?? storageError}</p>}
      {latestReport && !showHistory && <div role="status" className="flex shrink-0 items-center gap-3 border-b border-line bg-brand-soft px-4 py-2 text-sm">
        <span className="min-w-0 flex-1 truncate">New workout report: {latestReport.title.replace(/^Workout report:\s*/, "")}</span>
        <button disabled={disabled} onClick={() => { void run(() => open(latestReport.id)); }}
          className="min-h-11 shrink-0 font-semibold underline underline-offset-4 disabled:opacity-50">Open</button>
      </div>}
      {loading ? <div className="p-6"><TrainingLoader label="Opening your training space" /></div>
        : active ? <ConversationChat key={`${active.id}:${opened}`} initial={active} userId={userId} onSaved={saved} onBusy={setBusy}
          flushRef={flush} navigating={acting} onReopen={() => { void run(() => open(active.id)); }} />
          : <div className="min-h-0 flex-1 overflow-y-auto p-6 sm:p-10"><div className="training-hero"><p className="eyebrow">Your training starts here</p><h2>Show up.<br /><span>Move forward.</span></h2><p className="hero-description">A little direction for your next big effort. Open a chat and let’s get to work.</p></div>
            <button disabled={disabled} onClick={() => { void run(create); }} className="mt-4 min-h-11 rounded-xl bg-brand px-4 font-semibold">Start a new chat</button>
            {error && <button onClick={() => { void run(async () => { await list(); }); }} className="ml-4 min-h-11 underline">Retry loading chats</button>}
          </div>}
      {chatAction && (chatAction.kind === "rename"
        ? <ChatActionDialog key={`rename:${chatAction.chat.id}`} kind="rename" title={chatAction.chat.title} busy={acting}
          error={error} returnFocusRef={historyToggle} onClose={() => setChatAction(null)}
          onConfirm={(title) => { void run(() => rename(chatAction.chat, title)); }} />
        : <ChatActionDialog key={`delete:${chatAction.chat.id}`} kind="delete" title={chatAction.chat.title} busy={acting}
          error={error} returnFocusRef={historyToggle} onClose={() => setChatAction(null)}
          onConfirm={() => { void run(() => remove(chatAction.chat)); }} />)}
    </main>
  );
}
