import React from "react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";

export function activityLabel(name: string) {
  if (/create.*routine/i.test(name)) return "Create routine";
  if (/update.*routine/i.test(name)) return "Update routine";
  if (/delete/i.test(name)) return "Delete from Hevy";
  if (/exercise/i.test(name)) return "Exercise details";
  if (/routine/i.test(name)) return "Routine details";
  if (/workout/i.test(name)) return "Workout history";
  return "Hevy request";
}

export function ToolActivity({ parts, busy, disabled, onApprove }: {
  parts: UIMessage["parts"]; busy: boolean; disabled: boolean;
  onApprove: (id: string, approved: boolean) => void;
}) {
  const tools = parts.filter(isToolUIPart);
  if (!tools.length) return null;
  const approvals = tools.filter((part) => part.state === "approval-requested");
  const activity = tools.filter((part) => part.state !== "approval-requested");
  const failed = activity.some((part) => part.state === "output-error");
  const pending = activity.some((part) => !["output-available", "output-error", "output-denied"].includes(part.state));
  const declined = activity.some((part) => part.state === "output-denied");
  return <>
    {activity.length > 0 && <details className={`tool-activity ${failed ? "has-error" : ""}`}>
      <summary><span aria-hidden="true">{failed ? "!" : pending && busy ? "◌" : "↗"}</span>
        {failed ? "A Hevy request failed — view details" : pending ? (busy ? "Working with Hevy" : "Hevy activity interrupted") : declined ? "Hevy activity · change declined" : "Hevy activity"}
        <span className="activity-count">{activity.length}</span>
      </summary>
      <ul>{activity.map((part) => <li key={part.toolCallId}>
        <span>{activityLabel(getToolName(part))}</span>
        <span>{part.state === "output-error" ? "Failed — check connection before retrying"
          : part.state === "output-denied" ? "Declined"
            : part.state === "output-available" ? "Complete" : busy ? "In progress" : "Interrupted"}</span>
      </li>)}</ul>
      {failed && <p className="mt-3 text-xs">Check Hevy before repeating a change; it may have partially completed.</p>}
    </details>}
    {approvals.map((part) => part.state === "approval-requested" && <section key={part.toolCallId} className="approval-card">
      <p className="eyebrow">Your approval needed</p>
      <h3 className="mt-2 text-lg font-semibold">{activityLabel(getToolName(part))}</h3>
      <p className="mt-2 text-sm">This will change your Hevy account. Review the proposed change before approving.</p>
      <details className="mt-3"><summary className="cursor-pointer text-sm">Review change details</summary>
        <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(part.input, null, 2)}</pre>
      </details>
      <div className="mt-4 flex gap-3">
        <button disabled={disabled} className="min-h-11 rounded-xl bg-brand px-5 font-semibold disabled:opacity-50" onClick={() => onApprove(part.approval.id, true)}>Approve change</button>
        <button disabled={disabled} className="min-h-11 rounded-xl border border-line px-5 disabled:opacity-50" onClick={() => onApprove(part.approval.id, false)}>Decline</button>
      </div>
    </section>)}
  </>;
}
