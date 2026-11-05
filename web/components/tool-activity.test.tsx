import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { ToolActivity } from "./tool-activity";

function render(parts: UIMessage["parts"], busy = false) {
  return renderToStaticMarkup(<ToolActivity parts={parts} busy={busy} disabled={busy} onApprove={() => {}} />);
}
const completed = (id: string): UIMessage["parts"][number] => ({
  type: "dynamic-tool", toolName: "get-workouts", toolCallId: id,
  state: "output-available", input: {}, output: { private: "raw workout payload" },
});
describe("compact tool activity", () => {
  it("collapses repeated reads into one closed disclosure without raw results", () => {
    const html = render([completed("1"), completed("2"), completed("3")]);
    expect(html.match(/<summary/g)).toHaveLength(1);
    expect(html).not.toContain(" open=");
    expect(html).not.toContain("raw workout payload");
    expect(html).not.toContain("get-workouts");
    expect(html).toContain("Hevy activity");
  });
  it("keeps approvals visible outside the activity disclosure", () => {
    const html = render([completed("1"), { type: "dynamic-tool", toolName: "create-routine", toolCallId: "2", state: "approval-requested", input: { title: "Upper body" }, approval: { id: "approval-1" } }]);
    expect(html).toContain("Your approval needed");
    expect(html).toContain("Approve change");
    expect(html).toContain("Upper body");
    expect(html.indexOf("</details>")).toBeLessThan(html.indexOf("approval-card"));
  });
  it("surfaces failures in the closed summary", () => {
    const html = render([{ type: "dynamic-tool", toolName: "update-routine", toolCallId: "1", state: "output-error", input: {}, errorText: "internal error" }]);
    expect(html).toContain("A Hevy request failed — view details");
    expect(html).not.toContain("internal error");
  });
  it("does not leave a stopped request marked in progress", () => {
    const html = render([{ type: "dynamic-tool", toolName: "get-workouts", toolCallId: "1", state: "input-available", input: {} }]);
    expect(html).toContain("Hevy activity interrupted");
    expect(html).not.toContain("In progress");
  });
  it("adds nothing to a text-only message", () => { expect(render([{ type: "text", text: "Hello" }])).toBe(""); });
});
