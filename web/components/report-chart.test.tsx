import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CoachingText } from "./coaching-text";
import { ReportChart, parseChartBlock } from "./report-chart";

const weighted = {
  v: 1, title: "Bench press", current_date: "2026-11-18",
  series: [
    { key: "volume", label: "Total volume", unit: "kg", points: [{ date: "2026-08-21", value: 1380 }, { date: "2026-10-02", value: 1450.5 }, { date: "2026-11-18", value: 1312.5 }] },
    { key: "max_weight", label: "Max weight", unit: "kg", points: [{ date: "2026-08-21", value: 60 }, { date: "2026-10-02", value: 62.5 }, { date: "2026-11-18", value: 62.5 }] },
  ],
};
const fence = (body: string) => "Bench press: 3 sets\n\n```nakama-chart\n" + body + "\n```\n\nNext exercise";

describe("ReportChart", () => {
  it("renders an accessible svg per series with a data table", () => {
    const html = renderToStaticMarkup(<ReportChart text={JSON.stringify(weighted)} />);
    expect(html.match(/<svg width="100%"/g)).toHaveLength(2);
    expect(html.match(/role="img"/g)).toHaveLength(2);
    expect(html).toContain("<title");
    expect(html).toContain("Total volume over 3 sessions, from 1,380 kg on 21 Aug to 1,312.5 kg on 18 Nov");
    expect(html).toContain("Max weight over 3 sessions, from 60 kg on 21 Aug to 62.5 kg on 18 Nov");
    expect(html).toContain("<details");
    expect(html).toContain("Show data");
    expect(html).toContain("<td>1,450.5</td>");
    // y-axis min/max labels with units, first/last dates and the current value are HTML (never scaled svg text)
    expect(html).not.toContain("<text");
    expect(html).toContain("<span>1,450.5 kg</span>");
    expect(html).toContain("<span>1,312.5 kg</span>");
    expect(html).toContain("<span>21 Aug</span><span>18 Nov</span>");
    expect(html).toMatch(/class="report-chart-current-label"[^>]*>1,312.5 kg</);
    // the svg is not a scaled viewBox
    expect(html).not.toContain("viewBox");
    // aria-labelledby ids are unique across the two charts
    const ids = [...html.matchAll(/<title id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(2);
  });

  it("marks the current session by shape and size, not only color", () => {
    const html = renderToStaticMarkup(<ReportChart text={JSON.stringify(weighted)} />);
    const charts = html.split("<svg width").slice(1);
    for (const chart of charts) {
      // past sessions: small hollow circles; current session: one larger diamond path
      expect(chart.match(/<circle [^>]*class="report-chart-dot"/g)).toHaveLength(2);
      expect(chart).toMatch(/r="3.5"/);
      // marker ~2x the hollow points (half-diagonal 9 vs r 3.5) with a separate ink halo around it
      expect(chart).toContain('<path d="M0,-9L9,0L0,9L-9,0Z" class="report-chart-marker">');
      expect(chart).toContain('<path d="M0,-13L13,0L0,13L-13,0Z" class="report-chart-halo">');
    }
    expect(html.match(/<circle/g)).toHaveLength(4);
  });

  it("keeps the exercise title out of the visible chart (the report heading shows it)", () => {
    const title = "Incline dumbbell bench press with a very long descriptive exercise name";
    const html = renderToStaticMarkup(<ReportChart text={JSON.stringify({ ...weighted, title })} />);
    expect(html).not.toContain("report-chart-title");
    expect(html).toContain(`<title id="rc`);
    expect(html).toContain(`>${title}: Total volume</title>`);
    expect(html).toContain(`<caption class="report-chart-caption">${title}</caption>`);
    expect(html).not.toContain("<text");
  });

  it("does not repeat the unit for reps", () => {
    const block = { v: 1, title: "Pull up", current_date: "2026-11-18", series: [{ key: "total_reps", label: "Total reps", unit: "reps", points: [{ date: "2026-11-10", value: 24 }, { date: "2026-11-18", value: 30 }] }] };
    const html = renderToStaticMarkup(<ReportChart text={JSON.stringify(block)} />);
    expect(html).toContain('<figcaption class="report-chart-label">Total reps</figcaption>');
    expect(html).not.toContain("(reps)");
    const weightedHtml = renderToStaticMarkup(<ReportChart text={JSON.stringify(weighted)} />);
    expect(weightedHtml).toContain('<figcaption class="report-chart-label">Total volume (kg)</figcaption>');
  });

  it("renders a single bodyweight series", () => {
    const block = { v: 1, title: "Pull up", current_date: "2026-11-18", series: [{ key: "total_reps", label: "Total reps", unit: "reps", points: [{ date: "2026-11-10", value: 24 }, { date: "2026-11-18", value: 30 }] }] };
    const html = renderToStaticMarkup(<ReportChart text={JSON.stringify(block)} />);
    expect(html.match(/role="img"/g)).toHaveLength(1);
    expect(html).toContain("Total reps over 2 sessions, from 24 reps on 10 Nov to 30 reps on 18 Nov");
    expect(html).toMatch(/report-chart-current-label"[^>]*>30 reps</);
  });

  it("plots duplicate dates by order", () => {
    const block = { v: 1, title: "Squat", current_date: "2026-11-18", series: [{ key: "max_weight", label: "Max weight", unit: "lb", points: [{ date: "2026-11-18", value: 200 }, { date: "2026-11-18", value: 205 }] }] };
    const html = renderToStaticMarkup(<ReportChart text={JSON.stringify(block)} />);
    expect(html).toContain("<svg");
    expect(html.match(/<tr>/g)).toHaveLength(3); // header + 2 rows
    expect(html).toContain("from 200 lb on 18 Nov to 205 lb on 18 Nov");
  });

  it("handles a flat series without dividing by zero", () => {
    const block = { ...weighted, series: [{ ...weighted.series[1], points: [{ date: "2026-11-01", value: 50 }, { date: "2026-11-18", value: 50 }] }] };
    const html = renderToStaticMarkup(<ReportChart text={JSON.stringify(block)} />);
    expect(html).not.toContain("NaN");
  });

  const invalid: Record<string, string> = {
    "not json": "{nope",
    "extra top-level field": JSON.stringify({ ...weighted, extra: 1 }),
    "extra point field": JSON.stringify({ ...weighted, series: [{ ...weighted.series[0], points: [{ date: "2026-08-21", value: 1, note: "x" }, { date: "2026-11-18", value: 2 }] }] }),
    "wrong version": JSON.stringify({ ...weighted, v: 2 }),
    "too many series": JSON.stringify({ ...weighted, series: [...weighted.series, weighted.series[0]] }),
    "one point": JSON.stringify({ ...weighted, series: [{ ...weighted.series[0], points: [{ date: "2026-11-18", value: 1 }] }] }),
    "too many points": JSON.stringify({ ...weighted, series: [{ ...weighted.series[0], points: Array.from({ length: 61 }, () => ({ date: "2026-11-18", value: 1 })) }] }),
    "negative value": JSON.stringify({ ...weighted, series: [{ ...weighted.series[0], points: [{ date: "2026-08-21", value: -1 }, { date: "2026-11-18", value: 2 }] }] }),
    "bad date": JSON.stringify({ ...weighted, current_date: "2026-02-30" }),
    "html title too long": JSON.stringify({ ...weighted, title: "<b>x</b>".repeat(20) }),
    "oversized": JSON.stringify({ ...weighted, padding: "x".repeat(30_000) }),
    "unknown unit": JSON.stringify({ ...weighted, series: [{ ...weighted.series[0], unit: "stone" }] }),
  };
  for (const [name, text] of Object.entries(invalid)) {
    it(`shows "Chart unavailable" for ${name}`, () => {
      expect(parseChartBlock(text)).toBeNull();
      const html = renderToStaticMarkup(<CoachingText text={fence(text)} />);
      expect(html).toContain("Chart unavailable");
      expect(html).not.toContain("<svg");
      expect(html).not.toContain("<pre");
      expect(html).not.toContain("current_date");
    });
  }
});

describe("CoachingText chart routing", () => {
  it("renders nakama-chart fences as charts in place", () => {
    const html = renderToStaticMarkup(<CoachingText text={fence(JSON.stringify(weighted))} />);
    expect(html).toContain("<svg");
    expect(html).not.toContain("<pre");
    expect(html).not.toContain("current_date");
    expect(html.indexOf("Bench press: 3 sets")).toBeLessThan(html.indexOf("<svg"));
    expect(html.indexOf("<svg")).toBeLessThan(html.indexOf("Next exercise"));
  });

  it("leaves other code blocks unchanged", () => {
    const html = renderToStaticMarkup(<CoachingText text={"```json\n{\"a\":1}\n```\n\n```\nplain\n```\n\nuse `inline` code"} />);
    expect(html).toContain('<pre><code class="language-json">{&quot;a&quot;:1}\n</code></pre>');
    expect(html).toContain("<pre><code>plain\n</code></pre>");
    expect(html).toContain("<code>inline</code>");
    expect(html).not.toContain("<svg");
  });
});
