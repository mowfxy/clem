import type { ReactNode } from "react";
import { all, attr, find, kid, num, path, type Pkg } from "./package";
import { color, fillColor, type Theme } from "./drawingml";

/** A chart from a DrawingML chart part (PowerPoint's and Excel's native charts), drawn as SVG. */
export type ChartModel = {
  type: "bar" | "line" | "area" | "pie" | "doughnut" | "scatter" | "radar";
  horizontal: boolean; stacked: boolean; title?: string; legend: boolean;
  categories: string[]; series: { name: string; values: number[]; x?: number[]; color?: string; points?: (string | undefined)[] }[];
};
/** Reads a range ("'Sheet 1'!$B$2:$B$9") from a workbook's calculated cells, for charts that carry no cached values. */
export type RangeLookup = (sheet: string, r1: number, c1: number, r2: number, c2: number) => (string | number | null)[];
const KINDS: Record<string, ChartModel["type"]> = { barChart: "bar", bar3DChart: "bar", lineChart: "line", line3DChart: "line", areaChart: "area", area3DChart: "area", pieChart: "pie", pie3DChart: "pie", ofPieChart: "pie", doughnutChart: "doughnut", scatterChart: "scatter", bubbleChart: "scatter", radarChart: "radar" };
const letters = (s: string) => s.toUpperCase().split("").reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);

function cached(ref: Element | undefined, lookup?: RangeLookup): (string | number | null)[] {
  if (!ref) return [];
  const cache = find(ref, "strCache") || find(ref, "numCache") || find(ref, "multiLvlStrCache");
  if (cache) {
    const count = num(attr(find(cache, "ptCount"), "val"));
    const out: (string | number | null)[] = Array(count).fill(null);
    for (const pt of all(cache, "pt")) { const v = find(pt, "v")?.textContent ?? ""; out[num(attr(pt, "idx"))] = cache.localName === "numCache" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : v; }
    return out;
  }
  const formula = find(ref, "f")?.textContent || "";
  const m = /^(?:'((?:[^']|'')+)'|([^!']+))!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/i.exec(formula.trim());
  return m && lookup ? lookup((m[1] ?? m[2]).replace(/''/g, "'"), Number(m[4]), letters(m[3]), Number(m[6] ?? m[4]), letters(m[5] ?? m[3])) : [];
}

export function parseChart(pkg: Pkg, part: string, theme: Theme, lookup?: RangeLookup): ChartModel | undefined {
  const doc = pkg.xml(part);
  const plot = find(doc, "plotArea");
  const group = Array.from(plot?.children || []).find((c) => KINDS[c.localName]);
  if (!doc || !group) return undefined;
  const type = KINDS[group.localName];
  const palette = ["accent1", "accent2", "accent3", "accent4", "accent5", "accent6"].map((k) => "#" + theme.colors[k]);
  const series = Array.from(group.children).filter((c) => c.localName === "ser").map((ser, i) => {
    const catRef = kid(ser, "cat") || kid(ser, "xVal"), valRef = kid(ser, "val") || kid(ser, "yVal") || kid(ser, "bubbleSize");
    const values = cached(valRef, lookup).map((v) => (typeof v === "number" ? v : Number(v) || 0));
    const sp = kid(ser, "spPr");
    const mine = fillColor(sp, theme) || color(kid(kid(sp, "ln"), "solidFill")?.firstElementChild, theme) || undefined;
    const points = values.map((_, p) => { const dPt = all(ser, "dPt").find((d) => num(attr(find(d, "idx"), "val"), -1) === p); return fillColor(kid(dPt, "spPr"), theme) || undefined; });
    return { name: String(cached(kid(ser, "tx"), lookup)[0] ?? "Series " + (i + 1)), values, x: type === "scatter" ? cached(catRef, lookup).map((v) => Number(v) || 0) : undefined, color: mine || palette[i % 6], points, cat: cached(catRef, lookup) };
  });
  const first = series[0] as undefined | { cat: (string | number | null)[] };
  const title = all(find(doc, "title") || null, "t").map((t) => t.textContent).join("").trim() || undefined;
  const grouping = attr(find(group, "grouping"), "val");
  return {
    type, horizontal: attr(find(group, "barDir"), "val") === "bar", stacked: grouping === "stacked" || grouping === "percentStacked", title: attr(find(doc, "autoTitleDeleted"), "val") === "1" ? undefined : title, legend: !!path(find(doc, "chart") || undefined, "legend"),
    categories: (first?.cat || []).map((v) => (v === null ? "" : String(v))), series: series.map(({ cat: _cat, ...s }) => s),
  };
}

/** Axis ticks at 1, 2 or 5 times a power of ten that include [min, max]. */
function ticks(min: number, max: number) {
  if (min === max) max = min + 1;
  const raw = (max - min) / 5, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.999; v += step) { out.push(+v.toFixed(10)); if (v >= max) break; }
  return out;
}
const label = (n: number) => (Math.abs(n) >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 1 }) : String(+n.toFixed(2)));

export function ChartSvg({ model, width, height, font = "'Segoe UI', Arial, sans-serif" }: { model: ChartModel; width: number; height: number; font?: string }) {
  const { type, series, categories } = model;
  const pad = { l: 46, r: 16, t: model.title ? 34 : 14, b: (model.legend && type !== "pie" && type !== "doughnut" ? 28 : 8) + 26 };
  const text = ({ key, ...props }: { key?: string | number; [name: string]: unknown }, content: ReactNode) => <text key={key} fontFamily={font} fill="#595959" fontSize={11} {...props}>{content}</text>;
  const titleEl = model.title ? text({ x: width / 2, y: 20, textAnchor: "middle", fontSize: 14, fontWeight: 700, fill: "#262626" }, model.title) : null;
  const legend = (items: { name: string; color: string }[], y = height - 12) => {
    let x = 12;
    return items.map((s, i) => { const at = x; x += 26 + s.name.length * 6.4; return <g key={i}><rect x={at} y={y - 8} width={10} height={10} fill={s.color} rx={2} />{text({ x: at + 15, y: y + 1 }, s.name)}</g>; });
  };
  const frame = (children: ReactNode) => <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={{ display: "block" }}>{titleEl}{children}</svg>;
  if (type === "pie" || type === "doughnut") {
    const s = series[0], total = (s?.values || []).reduce((a, b) => a + Math.max(0, b), 0) || 1;
    const cx = width / 2, cy = (height + pad.t) / 2 - 6, r = Math.min(width, height - pad.t - 40) / 2 - 8, hole = type === "doughnut" ? r * 0.55 : 0;
    let angle = -Math.PI / 2;
    const palette = (i: number) => s?.points?.[i] || ["#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5", "#70AD47", "#264478", "#9E480E"][i % 8];
    const slices = (s?.values || []).map((v, i) => {
      const a0 = angle, a1 = angle + (Math.max(0, v) / total) * Math.PI * 2; angle = a1;
      const p = (rad: number, a: number) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
      const [x0, y0] = p(r, a0), [x1, y1] = p(r, a1), [x2, y2] = p(hole, a1), [x3, y3] = p(hole, a0), big = a1 - a0 > Math.PI ? 1 : 0;
      const d = a1 - a0 >= Math.PI * 2 - 1e-6 ? `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0` : `M${x0},${y0}A${r},${r} 0 ${big} 1 ${x1},${y1}${hole ? `L${x2},${y2}A${hole},${hole} 0 ${big} 0 ${x3},${y3}Z` : `L${cx},${cy}Z`}`;
      const mid = (a0 + a1) / 2, [lx, ly] = p((r + hole) / 2 + (hole ? 0 : r * 0.1), mid);
      return <g key={i}><path d={d} fill={palette(i)} stroke="#fff" strokeWidth={1.5} />{v / total > 0.04 && text({ x: lx, y: ly + 4, textAnchor: "middle", fill: "#fff", fontWeight: 700 }, Math.round((v / total) * 100) + "%")}</g>;
    });
    return frame(<>{slices}{legend(categories.map((c, i) => ({ name: c, color: palette(i) })))}</>);
  }
  if (type === "radar") {
    const n = categories.length || 1, cx = width / 2, cy = (height + pad.t) / 2 - 4, r = Math.min(width, height - pad.t - 40) / 2 - 22;
    const max = Math.max(1, ...series.flatMap((s) => s.values)), at = (i: number, k: number) => [cx + r * k * Math.sin((i / n) * Math.PI * 2), cy - r * k * Math.cos((i / n) * Math.PI * 2)];
    return frame(<>{[0.25, 0.5, 0.75, 1].map((k) => <polygon key={k} fill="none" stroke="#e3e6ea" points={categories.map((_, i) => at(i, k).join(",")).join(" ")} />)}
      {categories.map((c, i) => { const [x, y] = at(i, 1.12); return <g key={i}>{text({ x, y: y + 4, textAnchor: "middle" }, c)}</g>; })}
      {series.map((s, i) => <polygon key={i} fill={s.color} fillOpacity={0.2} stroke={s.color} strokeWidth={2} points={s.values.map((v, j) => at(j, v / max).join(",")).join(" ")} />)}{model.legend && legend(series.map((s) => ({ name: s.name, color: s.color! })))}</>);
  }
  // Cartesian charts.
  const scatter = type === "scatter", count = Math.max(categories.length, ...series.map((s) => s.values.length), 1);
  const stacked = model.stacked && (type === "bar" || type === "area");
  const sums = Array.from({ length: count }, (_, i) => series.reduce((a, s) => a + Math.max(0, s.values[i] || 0), 0));
  const lows = Math.min(0, ...series.flatMap((s) => s.values)), highs = stacked ? Math.max(...sums, 1) : Math.max(...series.flatMap((s) => s.values), 1);
  const axis = ticks(lows, highs), lo = axis[0], hi = axis.at(-1)!;
  const xs = scatter ? series.flatMap((s) => s.x || []) : [], xAxis = scatter ? ticks(Math.min(...xs, 0), Math.max(...xs, 1)) : [];
  const w = width - pad.l - pad.r, h = height - pad.t - pad.b, horizontal = model.horizontal && type === "bar";
  const yOf = (v: number) => pad.t + h - ((v - lo) / (hi - lo)) * h;
  const xOf = (i: number) => (scatter ? pad.l + (((series[0].x?.[i] ?? i) - xAxis[0]) / (xAxis.at(-1)! - xAxis[0])) * w : pad.l + ((i + 0.5) / count) * w);
  const hOf = (v: number) => pad.l + ((v - lo) / (hi - lo)) * w, cOf = (i: number) => pad.t + ((i + 0.5) / count) * h;
  const grid = axis.map((t) => horizontal
    ? <g key={t}><line x1={hOf(t)} x2={hOf(t)} y1={pad.t} y2={pad.t + h} stroke="#e3e6ea" />{text({ x: hOf(t), y: pad.t + h + 14, textAnchor: "middle", fontSize: 10 }, label(t))}</g>
    : <g key={t}><line x1={pad.l} x2={pad.l + w} y1={yOf(t)} y2={yOf(t)} stroke="#e3e6ea" />{text({ x: pad.l - 6, y: yOf(t) + 4, textAnchor: "end", fontSize: 10 }, label(t))}</g>);
  const cats = horizontal
    ? categories.slice(0, count).map((c, i) => text({ key: i, x: pad.l - 6, y: cOf(i) + 4, textAnchor: "end", fontSize: 10 }, c))
    : scatter ? xAxis.map((t) => text({ key: t, x: pad.l + ((t - xAxis[0]) / (xAxis.at(-1)! - xAxis[0])) * w, y: pad.t + h + 16, textAnchor: "middle", fontSize: 10 }, label(t)))
    : categories.slice(0, count).map((c, i) => text({ key: i, x: xOf(i), y: pad.t + h + 16, textAnchor: "middle", fontSize: 10 }, c.length > Math.max(6, w / count / 6) ? c.slice(0, Math.max(5, Math.floor(w / count / 6))) + "…" : c));
  const marks = series.map((s, si) => {
    if (type === "bar") {
      const slot = (horizontal ? h : w) / count, bar = stacked ? slot * 0.64 : (slot * 0.7) / series.length;
      return <g key={si} fill={s.color}>{s.values.map((v, i) => {
        const below = stacked ? series.slice(0, si).reduce((a, o) => a + Math.max(0, o.values[i] || 0), 0) : 0, from = stacked ? below : Math.min(0, v), to = stacked ? below + Math.max(0, v) : Math.max(0, v);
        const offset = stacked ? -bar / 2 : -(slot * 0.7) / 2 + si * bar;
        return horizontal ? <rect key={i} x={hOf(from)} y={cOf(i) + offset} width={Math.max(0, hOf(to) - hOf(from))} height={bar} /> : <rect key={i} x={xOf(i) + offset} y={yOf(to)} width={bar} height={Math.max(0, yOf(from) - yOf(to))} />;
      })}</g>;
    }
    const pts = s.values.map((v, i) => [xOf(i), yOf(stacked ? series.slice(0, si + 1).reduce((a, o) => a + Math.max(0, o.values[i] || 0), 0) : v)]);
    if (type === "area") { const base = stacked && si ? s.values.map((_, i) => [xOf(i), yOf(series.slice(0, si).reduce((a, o) => a + Math.max(0, o.values[i] || 0), 0))]).reverse() : [[pts.at(-1)![0], yOf(Math.max(0, lo))], [pts[0][0], yOf(Math.max(0, lo))]]; return <polygon key={si} fill={s.color} fillOpacity={0.55} stroke={s.color} points={[...pts, ...base].map((p) => p.join(",")).join(" ")} />; }
    return <g key={si}>{!scatter && <polyline fill="none" stroke={s.color} strokeWidth={2.2} strokeLinejoin="round" points={pts.map((p) => p.join(",")).join(" ")} />}{pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={scatter ? 3.6 : 3} fill={s.color} />)}</g>;
  });
  return frame(<>{grid}<line x1={pad.l} x2={pad.l + w} y1={horizontal ? pad.t + h : yOf(Math.max(lo, 0))} y2={horizontal ? pad.t + h : yOf(Math.max(lo, 0))} stroke="#bfbfbf" />{cats}{marks}{(model.legend || series.length > 1) && legend(series.map((s) => ({ name: s.name, color: s.color! })))}</>);
}
