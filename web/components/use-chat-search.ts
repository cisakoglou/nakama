"use client";

import { useCallback, useEffect, useState } from "react";
import { readApiResponse } from "@/lib/api-response";
import { conversationListSchema, type ConversationSummary } from "@/lib/conversation-types";

type SearchRequest = { query: string; page: number; revision: number };
type SearchResult = {
  request: SearchRequest;
  conversations: ConversationSummary[];
  hasMore: boolean;
  error: string | null;
};

export function useChatSearch() {
  const [query, setInput] = useState("");
  const [request, setRequest] = useState<SearchRequest>({ query: "", page: 0, revision: 0 });
  const [result, setResult] = useState<SearchResult | null>(null);
  const loading = Boolean(request.query) && result?.request !== request;
  const current = result?.request.query === request.query ? result : null;

  useEffect(() => {
    if (!request.query) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: request.query, page: String(request.page) });
        const data = await readApiResponse(await fetch(`/api/conversations?${params}`, {
          cache: "no-store", signal: controller.signal,
        }), conversationListSchema);
        if (controller.signal.aborted) return;
        setResult((old) => ({
          request, error: null, hasMore: data.hasMore,
          conversations: request.page > 0 && old?.request.query === request.query
            ? [...new Map([...old.conversations, ...data.conversations].map((chat) => [chat.id, chat])).values()]
            : data.conversations,
        }));
      } catch (error) {
        if (controller.signal.aborted) return;
        if (!(error instanceof Error)) throw error;
        setResult((old) => ({
          request, error: error.message, hasMore: request.page > 0,
          conversations: request.page > 0 && old?.request.query === request.query ? old.conversations : [],
        }));
      }
    }, request.page === 0 ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [request]);

  const setQuery = useCallback((value: string) => {
    setInput(value);
    const trimmed = value.trim();
    setRequest((old) => old.query === trimmed ? old : { ...old, query: trimmed, page: 0 });
  }, []);
  const reload = useCallback(() => {
    setRequest((old) => ({ ...old, page: 0, revision: old.revision + 1 }));
  }, []);
  const retry = () => setRequest((old) => ({ ...old, revision: old.revision + 1 }));
  const loadMore = () => {
    if (!loading && current?.hasMore && !current.error) setRequest((old) => ({ ...old, page: old.page + 1 }));
  };

  return {
    query, setQuery, term: request.query, conversations: current?.conversations ?? [],
    hasMore: current?.hasMore ?? false, loading, error: current?.error ?? null, loadMore, retry, reload,
  };
}
