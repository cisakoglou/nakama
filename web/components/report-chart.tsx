"use client";

import React from "react";
import { z } from "zod";
import { readApiResponse } from "@/lib/api-response";

// Mirrors CHART-CONTRACT.md (v1) and CHART-CONTRACT-v2.md exactly. Strict: unknown fields reject the whole block.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
});
const point = z.object({ date: isoDate, value: z.number().finite().min(0) }).strict();
const seriesSchema = (minPoints: number) => z.object({
  key: z.enum(["volume", "max_weight", "total_reps"]),
  label: z.string().min(1).max(40),
  unit: z.enum(["kg", "lb", "reps"]),
  points: z.array(point).min(minPoints).max(60),
}).strict();
const chartFields = (minPoints: number) => ({
  title: z.string().min(1).max(80),
  current_date: isoDate,
  series: z.array(seriesSchema(minPoints)).min(1).max(2),
});
const templateId = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const chartV1Schema = z.object({ v: z.literal(1), ...chartFields(2) }).strict();
const chartV2Fields = (minPoints: number) => ({ v: z.literal(2), exercise_template_id: templateId, ...chartFields(minPoints) });
export const chartBlockSchema = z.discriminatedUnion("v", [chartV1Schema, z.object(chartV2Fields(2)).strict()]);
export type ChartBlock = z.infer<typeof chartBlockSchema>;
export type ChartV2 = Extract<ChartBlock, { v: 2 }>;
type Series = ChartBlock["series"][number];

export const CHART_RANGES = ["3m", "6m", "9m", "1y"] as const;
export type ChartRange = (typeof CHART_RANGES)[number];
type Granularity = "session" | "week";
/** Range endpoint response (contract v2 §3): points may be 1-60. */
export const rangeResponseSchema = z.object({
  range: z.enum(CHART_RANGES),
  granularity: z.enum(["session", "week"]),
  chart: z.object(chartV2Fields(1)).strict(),
}).strict();
export type RangeView = { range: ChartRange; granularity: Granularity; chart: ChartBlock };

// Generous cap so a pathological block never reaches JSON.parse.
const MAX_BLOCK_CHARS = 20_000;

export function parseChartBlock(text: string): ChartBlock | null {
  const raw = text.trim();
  if (!raw || raw.length > MAX_BLOCK_CHARS) return null;
  try {
    const result = chartBlockSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatDate(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}
const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
export function formatValue(value: number, unit: Series["unit"]): string {
  return `${numberFormat.format(value)} ${unit}`;
}

// Geometry. The SVG is never scaled: y is in CSS px (fixed height) and x is a percentage of the
// plot width, so markers stay round and all text lives in HTML at a fixed >= 12px size.
const PLOT_H = 104;
const DIAMOND = 9; // half-diagonal of the current-session marker (~2x the hollow points)
const RING = 13; // half-diagonal of its ink halo; the canvas-filled band between them is the gap
const INSET = RING + 2; // keeps every marker, halo included, inside the plot box

// "Total reps", not "Total reps (reps)".
const seriesHeading = (s: Series) => s.unit === "reps" ? s.label : `${s.label} (${s.unit})`;
const diamond = (r: number) => `M0,${-r}L${r},0L0,${r}L${-r},0Z`;
const pct = (n: number) => `${Number(n.toFixed(3))}%`;

function SeriesChart({ block, series, id, granularity = "session" }: {
  block: ChartBlock; series: Series; id: string; granularity?: Granularity;
}) {
  const { points, unit, label } = series;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const flat = max === min;
  // A lone point (possible in a range response) sits at the right edge, where the latest point always is.
  const x = (i: number) => points.length === 1 ? 100 : (100 * i) / (points.length - 1);
  // Flat series sit on the middle of the plot.
  const y = (v: number) => flat ? PLOT_H / 2 : INSET + (PLOT_H - 2 * INSET) * (1 - (v - min) / (max - min));
  const first = points[0];
  const last = points[points.length - 1];
  const currentIndex = last.date === block.current_date ? points.length - 1 : -1;
  const dotR = points.length > 30 ? 2.5 : 3.5;
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;
  const span = granularity === "week"
    ? `${points.length} ${points.length === 1 ? "week" : "weeks"} (best session per week)`
    : `${points.length} ${points.length === 1 ? "session" : "sessions"}`;
  const desc = `${label} over ${span}, from ${formatValue(first.value, unit)} on ${formatDate(first.date)} to ${formatValue(last.value, unit)} on ${formatDate(last.date)}. Lowest ${formatValue(min, unit)}, highest ${formatValue(max, unit)}.${currentIndex >= 0 ? " Latest session highlighted." : ""}`;
  const cy = y(last.value);

  return (
    <figure className={`report-chart-series report-chart-${series.key}`}>
      <figcaption className="report-chart-label">{seriesHeading(series)}</figcaption>
      <div className="report-chart-grid-layout">
        {/* Visual labels only; the svg's title/desc and the data table carry them for screen readers. */}
        <div className="report-chart-current-label" aria-hidden="true">
          {currentIndex >= 0 && formatValue(last.value, unit)}
        </div>
        <div className="report-chart-yaxis" aria-hidden="true" style={{ height: PLOT_H, padding: `${INSET - 8}px 0` }}>
          <span>{formatValue(max, unit)}</span>
          {!flat && <span>{formatValue(min, unit)}</span>}
        </div>
        <svg width="100%" height={PLOT_H} role="img" aria-labelledby={`${titleId} ${descId}`} className="report-chart-svg">
          <title id={titleId}>{`${block.title}: ${label}`}</title>
          <desc id={descId}>{desc}</desc>
          <line x1="0" x2="100%" y1={flat ? PLOT_H / 2 : INSET} y2={flat ? PLOT_H / 2 : INSET} className="report-chart-grid" />
          {!flat && <line x1="0" x2="100%" y1={PLOT_H - INSET} y2={PLOT_H - INSET} className="report-chart-grid" />}
          {currentIndex >= 0 && cy - RING - 3 > 0 &&
            <line x1="100%" x2="100%" y1={0} y2={cy - RING - 3} className="report-chart-leader" />}
          {points.slice(1).map((p, i) => <line key={i} x1={pct(x(i))} y1={y(points[i].value)} x2={pct(x(i + 1))} y2={y(p.value)}
            className="report-chart-line" />)}
          {points.map((p, i) => i === currentIndex ? null :
            <circle key={i} cx={pct(x(i))} cy={y(p.value)} r={dotR} className="report-chart-dot" />)}
          {currentIndex >= 0 &&
            // Nested svg places the marker at a % x; the diamond is drawn around that origin in px.
            <svg x="100%" y={cy} overflow="visible" className="report-chart-current">
              <path d={diamond(RING)} className="report-chart-halo" />
              <path d={diamond(DIAMOND)} className="report-chart-marker" />
            </svg>}
        </svg>
        <div className="report-chart-xaxis" aria-hidden="true">
          <span>{formatDate(first.date)}</span>{points.length > 1 && <span>{formatDate(last.date)}</span>}
        </div>
      </div>
    </figure>
  );
}

function DataTable({ block, granularity = "session" }: { block: ChartBlock; granularity?: Granularity }) {
  const [a, b] = block.series;
  return (
    <details className="report-chart-data">
      <summary>Show data</summary>
      <div className="table-scroll">
        <table>
          <caption className="report-chart-caption">{block.title}</caption>
          <thead><tr><th scope="col">#</th><th scope="col">{granularity === "week" ? "Week of" : "Date"}</th>
            {block.series.map((s) => <th key={s.key} scope="col">{seriesHeading(s)}</th>)}</tr></thead>
          <tbody>
            {Array.from({ length: Math.max(a.points.length, b?.points.length ?? 0) }, (_, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{formatDate((a.points[i] ?? b!.points[i]).date)}</td>
                {block.series.map((s) => <td key={s.key}>{s.points[i] ? numberFormat.format(s.points[i].value) : "–"}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

const RANGE_LABELS: Record<ChartRange, { short: string; long: string }> = {
  "3m": { short: "3M", long: "3 months" },
  "6m": { short: "6M", long: "6 months" },
  "9m": { short: "9M", long: "9 months" },
  "1y": { short: "1Y", long: "1 year" },
};

// Per exercise + range + end date, for the life of the page.
const rangeCache = new Map<string, RangeView>();
export function clearRangeCache() { rangeCache.clear(); }
const cacheKey = (block: ChartV2, range: ChartRange) => `${block.exercise_template_id}|${range}|${block.current_date}`;
const embeddedView = (block: ChartV2): RangeView => ({ range: "3m", granularity: "session", chart: block });

/** The view for a range if it needs no request: 3M is the report's own data; others come from the cache. */
export function cachedRange(block: ChartV2, range: ChartRange): RangeView | undefined {
  return range === "3m" ? embeddedView(block) : rangeCache.get(cacheKey(block, range));
}

/** Loads a range from the endpoint (or cache) and validates it strictly. Throws on any failure. */
export async function loadRange(block: ChartV2, range: ChartRange): Promise<RangeView> {
  const cached = cachedRange(block, range);
  if (cached) return cached;
  const query = new URLSearchParams({ template: block.exercise_template_id, range, end: block.current_date });
  const response = await fetch(`/api/hevy/exercise-history?${query}`, { credentials: "same-origin" });
  const data = await readApiResponse(response, rangeResponseSchema);
  if (data.chart.exercise_template_id !== block.exercise_template_id || data.range !== range) {
    throw new Error("Unexpected chart range response.");
  }
  // Keep the report's own title; the endpoint's is only Hevy's template name.
  const view: RangeView = { range, granularity: data.granularity, chart: { ...data.chart, title: block.title } };
  rangeCache.set(cacheKey(block, range), view);
  return view;
}

function Charts({ view, id }: { view: RangeView; id: string }) {
  return <>
    {view.chart.series.map((s, i) => <SeriesChart key={s.key} block={view.chart} series={s} id={`${id}-${i}`}
      granularity={view.granularity} />)}
    <DataTable block={view.chart} granularity={view.granularity} />
  </>;
}

type RangeStatus = "idle" | "loading" | "error";

/** Stateless view of a v2 chart with its range toggle. */
export function RangeChartsView({ title, selected, shown, status, id, onSelect }: {
  title: string; selected: ChartRange; shown: RangeView; status: RangeStatus; id: string;
  onSelect: (range: ChartRange) => void;
}) {
  return (
    <section className="report-chart" aria-label={`${title} progress`}>
      <div className="report-chart-ranges" role="group" aria-label="Chart range">
        {CHART_RANGES.map((range) => (
          <button key={range} type="button" aria-pressed={selected === range} aria-label={`Last ${RANGE_LABELS[range].long}`}
            onClick={() => onSelect(range)}>{RANGE_LABELS[range].short}</button>
        ))}
      </div>
      <div className="report-chart-status">
        <span>Last {RANGE_LABELS[shown.range].long}{shown.granularity === "week" ? " · Best session per week" : ""}</span>
        <span role="status" aria-live="polite">
          {status === "loading" && `Loading ${RANGE_LABELS[selected].long}…`}
          {status === "error" && <>Couldn&apos;t load this range<button type="button" className="report-chart-retry"
            onClick={() => onSelect(selected)}>Retry</button></>}
        </span>
      </div>
      <div className={status === "loading" ? "report-chart-body is-loading" : "report-chart-body"} aria-busy={status === "loading"}>
        <Charts view={shown} id={id} />
      </div>
    </section>
  );
}

function RangeCharts({ block, id }: { block: ChartV2; id: string }) {
  const [selected, setSelected] = React.useState<ChartRange>("3m");
  const [shown, setShown] = React.useState<RangeView>(() => embeddedView(block));
  const [status, setStatus] = React.useState<RangeStatus>("idle");
  const wanted = React.useRef<ChartRange>("3m");

  const select = (range: ChartRange) => {
    wanted.current = range;
    setSelected(range);
    const cached = cachedRange(block, range);
    if (cached) {
      setShown(cached);
      setStatus("idle");
      return;
    }
    setStatus("loading");
    loadRange(block, range).then((view) => {
      if (wanted.current !== range) return;
      setShown(view);
      setStatus("idle");
    }, () => {
      // The last good chart stays visible.
      if (wanted.current === range) setStatus("error");
    });
  };

  return <RangeChartsView title={block.title} selected={selected} shown={shown} status={status} id={id} onSelect={select} />;
}

export function ReportChart({ text }: { text: string }) {
  const block = parseChartBlock(text);
  const id = `rc${React.useId().replace(/:/g, "")}`;
  if (!block) return <p className="report-chart-unavailable">Chart unavailable</p>;
  if (block.v === 2) return <RangeCharts block={block} id={id} />;
  return (
    <section className="report-chart" aria-label={`${block.title} progress`}>
      <Charts view={{ range: "3m", granularity: "session", chart: block }} id={id} />
    </section>
  );
}
