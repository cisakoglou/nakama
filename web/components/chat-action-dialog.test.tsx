import React, { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatActionDialog } from "./chat-action-dialog";

const common = {
  title: "Plan my next session",
  busy: false,
  error: null,
  returnFocusRef: createRef<HTMLButtonElement>(),
  onClose: () => {},
};

describe("chat action dialogs", () => {
  it("keeps a failed rename editable and associates its error with the field", () => {
    const html = renderToStaticMarkup(<ChatActionDialog {...common} kind="rename"
      error="This chat changed elsewhere." onConfirm={() => {}} />);
    expect(html).toContain('value="Plan my next session"');
    expect(html).toContain('aria-invalid="true" aria-describedby="chat-action-error"');
    expect(html).toContain('id="chat-action-error" class="chat-dialog-error" role="alert">This chat changed elsewhere.');
    expect(html).toContain("Save name");
    expect(html).not.toContain("disabled");
  });

  it("distinguishes deleting the chat from deleting Hevy workouts", () => {
    const html = renderToStaticMarkup(<ChatActionDialog {...common} kind="delete" onConfirm={() => {}} />);
    expect(html).toContain("The conversation and its draft will be permanently deleted.");
    expect(html).toContain("Your Hevy workouts won&#x27;t be affected.");
    expect(html).toContain('<span>Plan my next session</span>');
    expect(html).toContain("Keep chat");
    expect(html).not.toContain("<input");
  });

  it("disables confirmation and cancellation while a deletion is pending", () => {
    const html = renderToStaticMarkup(<ChatActionDialog {...common} kind="delete" busy onConfirm={() => {}} />);
    expect(html).toContain('aria-busy="true"');
    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(3);
    expect(html).toContain("Deleting...");
  });
});
