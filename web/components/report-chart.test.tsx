import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoachingText } from "./coaching-text";
import { RangeChartsView, ReportChart, cachedRange, clearRangeCache, loadRange, parseChartBlock, type ChartV2 } from "./report-chart";

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

describe("v2 charts with range toggle", () => {
  const v2 = { ...weighted, v: 2, exercise_template_id: "BENCH_1" };
  const v2Text = JSON.stringify(v2);

  it("v1 blocks have no range toggle", () => {
    const html = renderToStaticMarkup(<ReportChart text={JSON.stringify(weighted)} />);
    expect(html).not.toContain("report-chart-ranges");
    expect(html).not.toContain("aria-pressed");
  });

  it("v2 blocks show 3M | 6M | 9M | 1Y as pressed-state buttons with 3M selected", () => {
    const html = renderToStaticMarkup(<ReportChart text={v2Text} />);
    expect(html).toContain('role="group" aria-label="Chart range"');
    const buttons = [...html.matchAll(/<button type="button" aria-pressed="(true|false)" aria-label="([^"]+)">([^<]+)<\/button>/g)]
      .map((m) => [m[3], m[1], m[2]]);
    expect(buttons).toEqual([
      ["3M", "true", "Last 3 months"], ["6M", "false", "Last 6 months"], ["9M", "false", "Last 9 months"], ["1Y", "false", "Last 1 year"],
    ]);
    expect(html).toContain("<span>Last 3 months</span>");
    expect(html.match(/role="img"/g)).toHaveLength(2);
    expect(html).toContain("report-chart-current");
  });

  it("colours volume differently from max weight (labels still name each series)", () => {
    const html = renderToStaticMarkup(<ReportChart text={v2Text} />);
    expect(html).toContain('<figure class="report-chart-series report-chart-volume"><figcaption class="report-chart-label">Total volume (kg)</figcaption>');
    expect(html).toContain('<figure class="report-chart-series report-chart-max_weight"><figcaption class="report-chart-label">Max weight (kg)</figcaption>');
  });

  it.each([
    ["missing template id", { ...weighted, v: 2 }],
    ["bad template id", { ...v2, exercise_template_id: "../etc" }],
    ["template id on v1", { ...weighted, exercise_template_id: "BENCH_1" }],
  ])("rejects %s", (_, block) => {
    expect(renderToStaticMarkup(<ReportChart text={JSON.stringify(block)} />)).toContain("Chart unavailable");
  });

  const block = parseChartBlock(v2Text) as ChartV2;
  const weekly = {
    range: "9m", granularity: "week",
    chart: { ...v2, title: "Bench Press (Barbell)", series: v2.series.map((s) => ({ ...s, points: [{ date: "2026-03-02", value: 10 }, { date: "2026-11-16", value: 12 }] })) },
  };
  afterEach(() => { vi.unstubAllGlobals(); clearRangeCache(); });

  it("loads a range from the endpoint, validates it, keeps the report title and caches it", async () => {
    const fetchMock = vi.fn(async () => Response.json(weekly));
    vi.stubGlobal("fetch", fetchMock);
    expect(cachedRange(block, "9m")).toBeUndefined();
    const view = await loadRange(block, "9m");
    expect(fetchMock).toHaveBeenCalledWith("/api/hevy/exercise-history?template=BENCH_1&range=9m&end=2026-11-18", { credentials: "same-origin" });
    expect(view.granularity).toBe("week");
    expect(view.chart.title).toBe("Bench press");
    expect(await loadRange(block, "9m")).toBe(view);
    expect(cachedRange(block, "9m")).toBe(view);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("3M never requests anything", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await loadRange(block, "3m")).chart).toBe(block);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["an error status", () => Response.json({ error: "Hevy is temporarily unavailable. Please try again." }, { status: 502 })],
    ["an extra field", () => Response.json({ ...weekly, extra: 1 })],
    ["another exercise", () => Response.json({ ...weekly, chart: { ...weekly.chart, exercise_template_id: "SQUAT" } })],
    ["another range", () => Response.json({ ...weekly, range: "1y" })],
  ])("fails on %s and caches nothing", async (_, reply) => {
    vi.stubGlobal("fetch", vi.fn(async () => reply()));
    await expect(loadRange(block, "9m")).rejects.toThrow();
    expect(cachedRange(block, "9m")).toBeUndefined();
  });

  const embedded = { range: "3m" as const, granularity: "session" as const, chart: block };
  it("shows a loading state over the last good chart", () => {
    const html = renderToStaticMarkup(<RangeChartsView title="Bench press" selected="9m" shown={embedded} status="loading" id="t" onSelect={() => {}} />);
    expect(html).toContain('aria-pressed="true" aria-label="Last 9 months"');
    expect(html).toContain("Loading 9 months…");
    expect(html).toContain('class="report-chart-body is-loading" aria-busy="true"');
    expect(html.match(/role="img"/g)).toHaveLength(2);
  });

  it("shows an error with retry and keeps the last good chart", () => {
    const html = renderToStaticMarkup(<RangeChartsView title="Bench press" selected="1y" shown={embedded} status="error" id="t" onSelect={() => {}} />);
    expect(html).toContain("Couldn&#x27;t load this range");
    expect(html).toContain('<button type="button" class="report-chart-retry">Retry</button>');
    expect(html).toContain("<span>Last 3 months</span>");
    expect(html.match(/role="img"/g)).toHaveLength(2);
  });

  it("labels weekly charts as best session per week", () => {
    const view = { range: "9m" as const, granularity: "week" as const, chart: { ...weekly.chart, v: 2 as const, title: "Bench press" } };
    const html = renderToStaticMarkup(<RangeChartsView title="Bench press" selected="9m" shown={view as never} status="idle" id="t" onSelect={() => {}} />);
    expect(html).toContain("Last 9 months · Best session per week");
    expect(html).toContain("Total volume over 2 weeks (best session per week)");
    expect(html).toContain("<th scope=\"col\">Week of</th>");
    // The diamond only marks a point dated current_date; weekly points are dated Monday.
    expect(html).not.toContain("report-chart-marker");
  });

  it("draws a single-point range without NaN", () => {
    const one = { ...weekly.chart, v: 2 as const, series: [{ ...v2.series[0], points: [{ date: "2026-11-18", value: 5 }] }] };
    const html = renderToStaticMarkup(<RangeChartsView title="Bench press" selected="6m" shown={{ range: "6m", granularity: "session", chart: one as never }} status="idle" id="t" onSelect={() => {}} />);
    expect(html).not.toContain("NaN");
    expect(html).toContain("report-chart-marker");
  });
});

describe("How to read this report", () => {
  it("appears collapsed under messages with charts only", () => {
    const withChart = renderToStaticMarkup(<CoachingText text={fence(JSON.stringify(weighted))} />);
    expect(withChart).toContain('<details class="report-guide"><summary>How to read this report</summary>');
    expect(withChart).not.toContain("<details class=\"report-guide\" open");
    for (const term of ["Estimated 1RM", "Epley", "Top set", "Total volume", "3-month average", "PR", "diamond", "Best session per week", "Warm-up, drop and failure sets"]) {
      expect(withChart).toContain(term);
    }
    expect(withChart.indexOf("Next exercise")).toBeLessThan(withChart.indexOf("report-guide"));
    expect(renderToStaticMarkup(<CoachingText text={"Just chatting about `nakama-chart` blocks\n\n```json\n{}\n```"} />)).not.toContain("report-guide");
  });
});
