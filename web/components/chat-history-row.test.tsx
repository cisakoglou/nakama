import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ChatHistoryRow } from "./chat-history-row";

const props = {
  chat: {
    id: "00000000-0000-4000-8000-000000000001", title: "Plan my session", status: "ready" as const,
    created_at: "2026-11-18T17:00:00Z", updated_at: "2026-11-18T17:00:00Z",
    first_message_id: null,
  },
  active: false, unread: false, disabled: false, query: "",
  expanded: false, onToggle() {}, onDismiss() {}, onOpen() {}, onAction() {},
};

it("offers actions for an unopened chat without nesting buttons in the open control", () => {
  const html = renderToStaticMarkup(<ChatHistoryRow {...props} expanded />);
  expect(html).toContain('aria-label="Actions for Plan my session" aria-expanded="true"');
  expect(html).toContain('role="group" aria-label="Actions for Plan my session"');
  expect(html).toContain("Rename");
  expect(html).toContain("Delete");
  expect(html).not.toContain('aria-current="page"');
  expect(html.match(/<button\b[\s\S]*?<\/button>/)?.[0].match(/<button\b/g)).toHaveLength(1);
});

it("distinguishes reports visually and for screen readers while preserving title matches", () => {
  const html = renderToStaticMarkup(<ChatHistoryRow {...props}
    chat={{ ...props.chat, title: "Leg session", first_message_id: "workout-report-example" }} query="session" unread />);
  expect(html).toContain('class="chat-history-icon is-report"');
  expect(html).toContain('<span class="sr-only">Workout report: </span>');
  expect(html).toContain("<mark>session</mark>");
  expect(html).toContain('class="chat-history-new">New');
  const chat = renderToStaticMarkup(<ChatHistoryRow {...props} />);
  expect(chat).not.toContain('class="chat-history-icon is-report"');
  expect(chat).toContain('<span class="sr-only">Chat: </span>');
});
