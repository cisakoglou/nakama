"use client";

import { useEffect, useRef } from "react";
import { ChatIcon } from "@/components/chat-icon";
import { ChatSearchTitle } from "@/components/chat-search-title";
import type { ConversationSummary } from "@/lib/conversation-types";
import { isWorkoutReport } from "@/lib/report-notices";

type Props = {
  chat: ConversationSummary;
  active: boolean;
  unread: boolean;
  disabled: boolean;
  query: string;
  expanded: boolean;
  onToggle: () => void;
  onDismiss: () => void;
  onOpen: () => void;
  onAction: (kind: "rename" | "delete", chat: Pick<ConversationSummary, "id" | "title">) => void;
};

export function ChatHistoryRow({ chat, active, unread, disabled, query, expanded, onToggle, onDismiss, onOpen, onAction }: Props) {
  const row = useRef<HTMLDivElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  const report = isWorkoutReport(chat);
  const actionsId = `chat-actions-${chat.id}`;

  useEffect(() => {
    if (!expanded) return;
    actions.current?.querySelector("button")?.focus({ preventScroll: true });
    actions.current?.scrollIntoView({ block: "nearest" });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !row.current?.contains(event.target)) onDismiss();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [expanded, onDismiss]);

  return <div ref={row} className={`chat-history-item${active ? " is-current" : ""}`}
    onBlur={(event) => {
      if (expanded && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) onDismiss();
    }}>
    <button disabled={disabled} aria-current={active ? "page" : undefined} onClick={onOpen} className="chat-history-row">
      <span className={`chat-history-icon${report ? " is-report" : ""}`}><ChatIcon name={report ? "report" : "chat"} /></span>
      <span className="chat-history-copy">
        <span className="sr-only">{report ? "Workout report: " : "Chat: "}</span>
        <span className="chat-history-title"><ChatSearchTitle title={chat.title} query={query} />{unread && <span className="chat-history-new">New</span>}</span>
        <time dateTime={chat.updated_at}>{new Date(chat.updated_at).toLocaleString()}</time>
      </span>
      {active && <ChatIcon name="check" />}
    </button>
    <button disabled={disabled} className="chat-row-toggle" aria-label={`Actions for ${chat.title}`}
      aria-expanded={expanded} aria-controls={actionsId} onClick={onToggle}><ChatIcon name="dots" /></button>
    {expanded && <div ref={actions} id={actionsId} className="chat-row-actions" role="group" aria-label={`Actions for ${chat.title}`}>
      <button disabled={disabled} onClick={() => onAction("rename", chat)}><ChatIcon name="pencil" />Rename</button>
      <button disabled={disabled} onClick={() => onAction("delete", chat)} className="is-danger"><ChatIcon name="trash" />Delete</button>
    </div>}
  </div>;
}
