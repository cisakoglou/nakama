"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { chatRecovery } from "@/lib/chat-recovery";
import { readApiResponse } from "@/lib/api-response";
import { conversationResponseSchema, type Conversation } from "@/lib/conversation-types";

export function useChatDraft(initial: Conversation, userId: string, busy: boolean) {
  const [input, setInput] = useState(initial.draft);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(input);
  inputRef.current = input;
  const version = useRef(initial.draft_version);
  const saved = useRef(initial.draft);
  const conflict = useRef(false);
  const unreadable = useRef(false);
  const pending = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    try {
      const local = chatRecovery(window.localStorage, userId).draft(initial.id);
      if (local) {
        setInput(local.input);
        version.current = local.version;
        if (local.version !== initial.draft_version && local.input !== initial.draft) {
          conflict.current = true;
          setError("A recovered draft differs from the version saved elsewhere. Copy it before choosing Use saved draft.");
        } else {
          version.current = initial.draft_version;
        }
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      unreadable.current = true;
      setStorageError("This browser could not restore your local draft. The account's saved draft is shown; the unreadable local copy has not been overwritten.");
    }
    setReady(true);
  }, [initial.id, initial.draft, initial.draft_version, userId]);

  useEffect(() => {
    if (!ready || busy || unreadable.current) return;
    try {
      chatRecovery(window.localStorage, userId).saveDraft(initial.id, input, version.current);
      setStorageError(null);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setStorageError("Browser draft recovery is unavailable. Wait for account saving before leaving.");
    }
  }, [initial.id, input, ready, busy, userId]);

  const flush = useCallback(async (): Promise<boolean> => {
    while (pending.current) {
      if (!await pending.current) return false;
    }
    if (conflict.current) return false;
    if (inputRef.current === saved.current) return true;
    const text = inputRef.current;
    setSaving(true);
    const operation = (async () => {
      try {
        const response = await fetch(`/api/conversations/${initial.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draft: text, draftVersion: version.current }),
        });
        if (response.status === 409) conflict.current = true;
        const { conversation } = await readApiResponse(response, conversationResponseSchema);
        version.current = conversation.draft_version;
        saved.current = text;
        if (!unreadable.current) {
          try {
            chatRecovery(window.localStorage, userId).saveDraft(initial.id, inputRef.current, version.current);
            setStorageError(null);
          } catch (error) {
            if (!(error instanceof Error)) throw error;
            setStorageError("The draft is saved to your account, but browser draft recovery is unavailable.");
          }
        }
        setError(null);
        return true;
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        setError(error.message);
        return false;
      } finally {
        pending.current = null;
        setSaving(false);
      }
    })();
    pending.current = operation;
    if (!await operation) return false;
    return inputRef.current === text || flush();
  }, [initial.id, userId]);

  useEffect(() => {
    if (!ready || busy) return;
    const timer = window.setTimeout(() => { void flush(); }, 500);
    return () => window.clearTimeout(timer);
  }, [input, ready, busy, flush]);

  function accepted(draftVersion: number, clearDraft: boolean) {
    version.current = draftVersion;
    if (!clearDraft) return;
    saved.current = "";
    setError(null);
    if (unreadable.current) return;
    try { chatRecovery(window.localStorage, userId).clearDraft(initial.id); }
    catch (error) {
      if (!(error instanceof Error)) throw error;
      setStorageError("The sent draft could not be cleared from this browser.");
    }
  }

  async function useSaved() {
    if (!window.confirm("Discard the recovered draft and load the account's saved version?")) return;
    try {
      const response = await fetch(`/api/conversations/${initial.id}`, { cache: "no-store" });
      const { conversation } = await readApiResponse(response, conversationResponseSchema);
      if (unreadable.current) {
        chatRecovery(window.localStorage, userId).clearDraft(initial.id);
        unreadable.current = false;
        setStorageError(null);
      }
      version.current = conversation.draft_version;
      saved.current = conversation.draft;
      conflict.current = false;
      setInput(conversation.draft);
      setError(null);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setError(error.message);
    }
  }

  return { input, setInput, ready, error, storageError, saving, version, flush, accepted, useSaved, recoveryBlocked: unreadable.current };
}
