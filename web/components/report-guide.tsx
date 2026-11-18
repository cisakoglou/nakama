import React from "react";

/** Collapsed glossary shown under a workout report that contains charts. Not part of the stored report. */
export function ReportGuide() {
  return (
    <details className="report-guide">
      <summary>How to read this report</summary>
      <dl>
        <dt>Estimated 1RM</dt>
        <dd>The most you could likely lift for one rep, estimated from a set of 1 to 12 reps with the Epley formula. It is an estimate, not a tested max.</dd>
        <dt>Top set</dt>
        <dd>Your heaviest working set of the exercise that session.</dd>
        <dt>Total volume</dt>
        <dd>Weight × reps, added up over all working sets.</dd>
        <dt>3-month average</dt>
        <dd>The average of your sessions of that exercise over the previous 3 months, so one good or bad day stands out less.</dd>
        <dt>PR</dt>
        <dd>A personal record: this workout beat every previous session of the exercise you have logged.</dd>
        <dt>Charts</dt>
        <dd>Each dot is a session and the large diamond is this workout. Longer ranges (9M, 1Y) say “Best session per week”: there each dot is your best session of that week.</dd>
        <dt>Not counted</dt>
        <dd>Warm-up, drop and failure sets are left out, so only your normal working sets count.</dd>
      </dl>
    </details>
  );
}
