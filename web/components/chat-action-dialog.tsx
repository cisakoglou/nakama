"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { ChatIcon } from "@/components/chat-icon";

type Props = {
  title: string;
  busy: boolean;
  error: string | null;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
} & (
  | { kind: "rename"; onConfirm: (title: string) => void }
  | { kind: "delete"; onConfirm: () => void }
);

export function ChatActionDialog(props: Props) {
  const { kind, title, busy, error, returnFocusRef, onClose } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [name, setName] = useState(title);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    if (kind === "rename") { input.current?.focus(); input.current?.select(); }
    else cancel.current?.focus();
    return () => { element?.close(); returnFocusRef.current?.focus(); };
  }, [kind, returnFocusRef]);

  const message = validationError ?? error;
  return <dialog ref={dialog} className="chat-action-dialog" aria-labelledby="chat-action-title"
    aria-describedby="chat-action-description" aria-busy={busy}
    onKeyDown={(event) => {
      if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey) return;
      const controls = event.currentTarget.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button:not(:disabled), input:not(:disabled)");
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={(event) => {
      if (busy || event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <form className="chat-dialog-card" onSubmit={(event) => {
      event.preventDefault();
      if (busy) return;
      if (props.kind === "rename") {
        const trimmed = name.trim();
        if (!trimmed) {
          setValidationError("Enter a chat name.");
          input.current?.focus();
          return;
        }
        props.onConfirm(trimmed);
      } else props.onConfirm();
    }}>
      {kind === "delete" && <span className="chat-dialog-danger-icon"><ChatIcon name="trash" /></span>}
      <div className="chat-dialog-heading">
        <h2 id="chat-action-title">{kind === "rename" ? "Give it a name." : "Delete this chat?"}</h2>
        <button type="button" className="chat-dialog-close" onClick={onClose} disabled={busy} aria-label="Cancel">
          <ChatIcon name="close" />
        </button>
      </div>
      <p id="chat-action-description">{kind === "rename"
        ? "Make this chat easier to find next time."
        : "The conversation and its draft will be permanently deleted. Your Hevy workouts won't be affected."}</p>
      {kind === "rename" ? <>
        <label htmlFor="chat-name">Chat name</label>
        <input ref={input} id="chat-name" value={name} maxLength={80} disabled={busy} autoComplete="off"
          aria-invalid={Boolean(message)} aria-describedby={message ? "chat-action-error" : undefined}
          onChange={(event) => { setName(event.target.value); setValidationError(null); }} />
      </> : <div className="chat-dialog-reference"><ChatIcon name="chat" /><span>{title}</span></div>}
      {message && <p id="chat-action-error" className="chat-dialog-error" role="alert">{message}</p>}
      <div className="chat-dialog-buttons">
        <button ref={cancel} type="button" className="chat-dialog-button" onClick={onClose} disabled={busy}>
          {kind === "rename" ? "Cancel" : "Keep chat"}
        </button>
        <button type="submit" className={`chat-dialog-button ${kind === "rename" ? "is-primary" : "is-destructive"}`} disabled={busy}>
          {kind === "rename" ? busy ? "Saving..." : "Save name" : busy ? "Deleting..." : "Delete chat"}
        </button>
      </div>
    </form>
  </dialog>;
}
