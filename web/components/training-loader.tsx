"use client";

import { useEffect, useState } from "react";

const prompts = [
  "Next up: ask what to aim for in your next session.",
  "Zoom out: ask how your last few weeks compare.",
  "Make it yours: tell your Nakama how much time you have today.",
];

export function TrainingLoader({ label = "Warming up your training space", responding = false }: {
  label?: string; responding?: boolean;
}) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const slow = seconds >= 5;
  const title = seconds >= 30
    ? "Your Nakama is taking a little longer than usual"
    : slow && responding
      ? "Your Nakama is still with you"
      : slow
        ? "Still with you. Give it a moment."
        : label;
  return (
    <div className={`training-loader ${slow ? "is-slow" : ""}`}>
      <div className="flex items-center gap-4">
        <div className="loading-bars" aria-hidden="true"><i /><i /><i /><i /><i /></div>
        <div className="min-w-0 flex-1">
          <p role="status" className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-xs text-ink-muted">{responding
            ? "Looking through your training and putting the response together."
            : "Getting everything ready for you."}</p>
        </div>
        <span aria-hidden="true" className="text-xs tabular-nums text-ink-muted">{seconds}s</span>
      </div>
      {slow && <div className="loading-note">
        <span className="eyebrow">While you wait</span>
        <p className="mt-2 text-sm leading-6">{prompts[Math.floor((seconds - 5) / 8) % prompts.length]}</p>
        {responding && <p className="mt-2 text-xs text-ink-muted">You can stop the response below at any time.</p>}
      </div>}
    </div>
  );
}
