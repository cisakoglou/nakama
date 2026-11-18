import React from "react";
import { z } from "zod";

// Mirrors CHART-CONTRACT.md exactly. Strict: unknown fields reject the whole block.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
});
const point = z.object({ date: isoDate, value: z.number().finite().min(0) }).strict();
const series = z.object({
  key: z.enum(["volume", "max_weight", "total_reps"]),
  label: z.string().min(1).max(40),
  unit: z.enum(["kg", "lb", "reps"]),
  points: z.array(point).min(2).max(60),
}).strict();
export const chartBlockSchema = z.object({
  v: z.literal(1),
  title: z.string().min(1).max(80),
  current_date: isoDate,
  series: z.array(series).min(1).max(2),
}).strict();
export type ChartBlock = z.infer<typeof chartBlockSchema>;
type Series = ChartBlock["series"][number];

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
const PLOT_H = 96;
const INSET = 8; // keeps the min/max markers inside the plot box
const DIAMOND = 7; // half-diagonal of the current-session marker

const pct = (n: number) => `${Number(n.toFixed(3))}%`;

function SeriesChart({ block, series, id }: { block: ChartBlock; series: Series; id: string }) {
  const { points, unit, label } = series;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const flat = max === min;
  const x = (i: number) => (100 * i) / (points.length - 1);
  // Flat series sit on the middle of the plot.
  const y = (v: number) => flat ? PLOT_H / 2 : INSET + (PLOT_H - 2 * INSET) * (1 - (v - min) / (max - min));
  const first = points[0];
  const last = points[points.length - 1];
  const currentIndex = last.date === block.current_date ? points.length - 1 : -1;
  const dotR = points.length > 30 ? 2.5 : 3.5;
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;
  const desc = `${label} over ${points.length} sessions, from ${formatValue(first.value, unit)} on ${formatDate(first.date)} to ${formatValue(last.value, unit)} on ${formatDate(last.date)}. Lowest ${formatValue(min, unit)}, highest ${formatValue(max, unit)}.${currentIndex >= 0 ? " Latest session highlighted." : ""}`;
  const cy = y(last.value);

  return (
    <figure className="report-chart-series">
      <figcaption className="report-chart-label">{label} ({unit})</figcaption>
      <div className="report-chart-grid-layout">
        {/* Visual labels only; the svg's title/desc and the data table carry them for screen readers. */}
        <div className="report-chart-current-label" aria-hidden="true">
          {currentIndex >= 0 && formatValue(last.value, unit)}
        </div>
        <div className="report-chart-yaxis" aria-hidden="true" style={{ height: PLOT_H }}>
          <span>{formatValue(max, unit)}</span>
          {!flat && <span>{formatValue(min, unit)}</span>}
        </div>
        <svg width="100%" height={PLOT_H} role="img" aria-labelledby={`${titleId} ${descId}`} className="report-chart-svg">
          <title id={titleId}>{`${block.title}: ${label}`}</title>
          <desc id={descId}>{desc}</desc>
          <line x1="0" x2="100%" y1={flat ? PLOT_H / 2 : INSET} y2={flat ? PLOT_H / 2 : INSET} className="report-chart-grid" />
          {!flat && <line x1="0" x2="100%" y1={PLOT_H - INSET} y2={PLOT_H - INSET} className="report-chart-grid" />}
          {currentIndex >= 0 && cy - DIAMOND - 3 > 0 &&
            <line x1="100%" x2="100%" y1={0} y2={cy - DIAMOND - 3} className="report-chart-leader" />}
          {points.slice(1).map((p, i) => <line key={i} x1={pct(x(i))} y1={y(points[i].value)} x2={pct(x(i + 1))} y2={y(p.value)}
            className="report-chart-line" />)}
          {points.map((p, i) => i === currentIndex ? null :
            <circle key={i} cx={pct(x(i))} cy={y(p.value)} r={dotR} className="report-chart-dot" />)}
          {currentIndex >= 0 &&
            // Nested svg places the marker at a % x; the diamond is drawn around that origin in px.
            <svg x="100%" y={cy} overflow="visible" className="report-chart-current">
              <path d={`M0,${-DIAMOND}L${DIAMOND},0L0,${DIAMOND}L${-DIAMOND},0Z`} />
            </svg>}
        </svg>
        <div className="report-chart-xaxis" aria-hidden="true">
          <span>{formatDate(first.date)}</span><span>{formatDate(last.date)}</span>
        </div>
      </div>
    </figure>
  );
}

function DataTable({ block }: { block: ChartBlock }) {
  const [a, b] = block.series;
  return (
    <details className="report-chart-data">
      <summary>Show data</summary>
      <div className="table-scroll">
        <table>
          <thead><tr><th scope="col">#</th><th scope="col">Date</th>
            {block.series.map((s) => <th key={s.key} scope="col">{`${s.label} (${s.unit})`}</th>)}</tr></thead>
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

export function ReportChart({ text }: { text: string }) {
  const block = parseChartBlock(text);
  const id = React.useId().replace(/:/g, "");
  if (!block) return <p className="report-chart-unavailable">Chart unavailable</p>;
  return (
    <section className="report-chart" aria-label={`${block.title} progress`}>
      <p className="report-chart-title">{block.title}</p>
      {block.series.map((s, i) => <SeriesChart key={s.key} block={block} series={s} id={`rc${id}-${i}`} />)}
      <DataTable block={block} />
    </section>
  );
}
