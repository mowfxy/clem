/**
 * Concept diagrams for documents: flowcharts, charts, timelines, cycles, mind maps, trees and Venn diagrams.
 * Pure functions from plain JSON to SVG in the document's own typography and colours, so a PDF never needs a
 * hand-written picture. Every label is escaped and every size is bounded.
 */
const ACCENT = "#1f4e79", INK = "#1b1d21", MUTED = "#5c6169", LINE = "#8a9098", PAPER = "#ffffff";
const FILLS = ["#e8f0f8", "#fbeee6", "#e9f4e6", "#fbf3e0", "#efe9f6", "#e4f3f2"];
const STROKES = ["#1f4e79", "#b4532a", "#3f7a31", "#b7801a", "#6b4c9a", "#237b7b"];
const SERIES = ["#1f4e79", "#c0504d", "#4f8a3c", "#d08c1f", "#6b4c9a", "#2a8c8c", "#7a7f87", "#a33d6b"];
const FONT = "'Mowafy Sans','Segoe UI',Calibri,Arial,sans-serif";

const esc = (text: unknown) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const num = (n: number) => (Math.round(n * 10) / 10).toString();
/** Average glyph width of Segoe UI at 1px, for wrapping without a browser. */
const textWidth = (text: string, size: number) => [...text].reduce((w, c) => w + (/[ilj.,:;'|!]/.test(c) ? 0.28 : /[mwMW@]/.test(c) ? 0.85 : /[A-Z0-9]/.test(c) ? 0.62 : 0.52), 0) * size;
function wrap(text: string, max: number, size: number, lines = 4) {
  const words = String(text ?? "").replace(/\s+/g, " ").trim().split(" ");
  const out: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? line + " " + word : word;
    if (textWidth(next, size) <= max || !line) line = next;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  if (out.length > lines) { out.length = lines; out[lines - 1] = out[lines - 1].replace(/\s*\S*$/, "") + "…"; }
  return out;
}
function textBlock(lines: string[], x: number, y: number, size: number, { weight = 400, color = INK, anchor = "middle" }: { weight?: number; color?: string; anchor?: string } = {}) {
  const lead = size * 1.25, top = y - ((lines.length - 1) * lead) / 2;
  return `<text x="${num(x)}" y="${num(top)}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}" dominant-baseline="middle">${lines.map((l, i) => `<tspan x="${num(x)}" dy="${i ? num(lead) : 0}">${esc(l)}</tspan>`).join("")}</text>`;
}
const arrowDef = (id = "arrow", color = LINE) => `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${color}"/></marker>`;
function svg(width: number, height: number, body: string, title?: string) {
  const head = title ? 34 : 0;
  const w = Math.ceil(width), h = Math.ceil(height + head);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${PAPER}"/>` +
    (title ? textBlock([title], w / 2, 18, 15, { weight: 600, color: INK }) : "") + `<g transform="translate(0 ${head})">${body}</g></svg>`;
}
const list = <T,>(value: unknown, name: string, max: number): T[] => {
  if (!Array.isArray(value) || !value.length) throw Error(`${name} must be a non-empty list`);
  if (value.length > max) throw Error(`${name} can have at most ${max} entries`);
  return value as T[];
};

type FlowNode = { id: string; label: string; shape?: "process" | "decision" | "start" | "end" | "io" | "note" | "data" };
type FlowEdge = { from: string; to: string; label?: string };
/**
 * A flowchart laid out in layers (top to bottom, or left to right), with decisions as diamonds, start/end as pills,
 * input/output as parallelograms, labelled arrows, and loops drawn around the side instead of through boxes.
 */
export function flowchart(spec: { title?: string; direction?: "down" | "right"; nodes: FlowNode[]; edges: FlowEdge[]; width?: number }) {
  const nodes = list<FlowNode>(spec?.nodes, "nodes", 40), edges = Array.isArray(spec?.edges) ? spec.edges.slice(0, 80) : [];
  const ids = new Set<string>();
  for (const n of nodes) { if (!n || typeof n.id !== "string" || typeof n.label !== "string") throw Error('each node needs "id" and "label"'); if (ids.has(n.id)) throw Error(`duplicate node id "${n.id}"`); ids.add(n.id); }
  for (const e of edges) if (!ids.has(e?.from) || !ids.has(e?.to)) throw Error(`edge ${e?.from} → ${e?.to} refers to a missing node`);
  const across = spec.direction === "right";
  // Back edges (loops) are found by depth-first search so layering follows the forward flow.
  const out = new Map<string, FlowEdge[]>(nodes.map((n) => [n.id, []]));
  edges.forEach((e) => out.get(e.from)!.push(e));
  const state = new Map<string, number>(), back = new Set<FlowEdge>();
  const visit = (id: string) => { state.set(id, 1); for (const e of out.get(id)!) { const s = state.get(e.to); if (s === 1) back.add(e); else if (!s) visit(e.to); } state.set(id, 2); };
  const incoming = new Set(edges.map((e) => e.to));
  for (const n of nodes) if (!incoming.has(n.id) && !state.get(n.id)) visit(n.id);
  for (const n of nodes) if (!state.get(n.id)) visit(n.id);
  const forward = edges.filter((e) => !back.has(e) && e.from !== e.to);
  const layer = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < nodes.length; pass++) { let moved = false; for (const e of forward) if (layer.get(e.to)! < layer.get(e.from)! + 1) { layer.set(e.to, layer.get(e.from)! + 1); moved = true; } if (!moved) break; }
  const layers: string[][] = [];
  nodes.forEach((n) => (layers[layer.get(n.id)!] ||= []).push(n.id));
  // Two barycentre sweeps reduce crossings.
  for (let sweep = 0; sweep < 2; sweep++) for (let i = 1; i < layers.length; i++) {
    const prev = layers[i - 1] || [], pos = (id: string) => { const parents = forward.filter((e) => e.to === id).map((e) => prev.indexOf(e.from)).filter((x) => x >= 0); return parents.length ? parents.reduce((a, b) => a + b, 0) / parents.length : Infinity; };
    layers[i] = (layers[i] || []).slice().sort((a, b) => pos(a) - pos(b));
  }
  const size = 12.5, boxW = across ? 150 : 170;
  const dims = new Map<string, { w: number; h: number; lines: string[] }>();
  for (const n of nodes) {
    const decision = n.shape === "decision";
    const lines = wrap(n.label, decision ? boxW * 0.62 : boxW - 22, size, decision ? 3 : 4);
    const h = Math.max(decision ? 70 : 42, lines.length * size * 1.25 + (decision ? 40 : 20));
    dims.set(n.id, { w: decision ? boxW + 10 : boxW, h, lines });
  }
  const gapMain = across ? 70 : 54, gapCross = 34;
  const layerSize = layers.map((ids) => Math.max(...(ids || []).map((id) => across ? dims.get(id)!.w : dims.get(id)!.h)));
  const crossSize = layers.map((ids) => (ids || []).reduce((s, id) => s + (across ? dims.get(id)!.h : dims.get(id)!.w) + gapCross, -gapCross));
  const crossTotal = Math.max(...crossSize), margin = 34, loopRoom = back.size ? 46 : 0;
  const pos = new Map<string, { x: number; y: number }>();
  let main = margin;
  layers.forEach((ids, i) => {
    let cross = margin + (crossTotal - crossSize[i]) / 2;
    for (const id of ids || []) {
      const d = dims.get(id)!, along = across ? d.w : d.h, side = across ? d.h : d.w;
      const c = { main: main + layerSize[i] / 2, cross: cross + side / 2 };
      pos.set(id, across ? { x: c.main, y: c.cross } : { x: c.cross, y: c.main });
      cross += side + gapCross;
      void along;
    }
    main += layerSize[i] + gapMain;
  });
  const width = across ? main - gapMain + margin : crossTotal + margin * 2 + loopRoom;
  const height = across ? crossTotal + margin * 2 + loopRoom : main - gapMain + margin;
  const shape = (n: FlowNode) => {
    const { x, y } = pos.get(n.id)!, { w, h, lines } = dims.get(n.id)!, l = x - w / 2, t = y - h / 2;
    const k = n.shape || "process";
    const fill = k === "decision" ? "#fbf3e0" : k === "start" || k === "end" ? "#e8f0f8" : k === "note" ? "#f6f7f8" : k === "io" || k === "data" ? "#e9f4e6" : PAPER;
    const stroke = k === "decision" ? "#b7801a" : k === "note" ? "#9aa0a8" : k === "io" || k === "data" ? "#3f7a31" : ACCENT;
    const body = k === "decision" ? `<polygon points="${num(x)},${num(t)} ${num(l + w)},${num(y)} ${num(x)},${num(t + h)} ${num(l)},${num(y)}" fill="${fill}" stroke="${stroke}" stroke-width="1.4"/>`
      : k === "start" || k === "end" ? `<rect x="${num(l)}" y="${num(t)}" width="${num(w)}" height="${num(h)}" rx="${num(h / 2)}" fill="${fill}" stroke="${stroke}" stroke-width="1.4"/>`
      : k === "io" || k === "data" ? `<polygon points="${num(l + 14)},${num(t)} ${num(l + w)},${num(t)} ${num(l + w - 14)},${num(t + h)} ${num(l)},${num(t + h)}" fill="${fill}" stroke="${stroke}" stroke-width="1.4"/>`
      : `<rect x="${num(l)}" y="${num(t)}" width="${num(w)}" height="${num(h)}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="${k === "note" ? 1 : 1.4}"${k === "note" ? ' stroke-dasharray="4 3"' : ""}/>`;
    return body + textBlock(lines, x, y, size, { weight: k === "start" || k === "end" ? 600 : 400 });
  };
  // Where a line leaves or enters a node's outline, toward a point.
  const edgePoint = (id: string, toward: { x: number; y: number }) => {
    const p = pos.get(id)!, d = dims.get(id)!, dx = toward.x - p.x, dy = toward.y - p.y;
    if (!dx && !dy) return p;
    const diamond = nodes.find((n) => n.id === id)!.shape === "decision";
    const s = diamond ? 1 / (Math.abs(dx) / (d.w / 2) + Math.abs(dy) / (d.h / 2)) : Math.min(Math.abs((d.w / 2) / (dx || 1e-9)), Math.abs((d.h / 2) / (dy || 1e-9)));
    return { x: p.x + dx * s, y: p.y + dy * s };
  };
  const label = (text: string | undefined, x: number, y: number) => {
    if (!text) return "";
    const lines = wrap(text, 110, 11, 2), w = Math.max(...lines.map((l) => textWidth(l, 11))) + 10, h = lines.length * 14 + 4;
    return `<rect x="${num(x - w / 2)}" y="${num(y - h / 2)}" width="${num(w)}" height="${num(h)}" rx="3" fill="${PAPER}"/>` + textBlock(lines, x, y, 11, { color: MUTED, weight: 600 });
  };
  let drawn = "";
  for (const e of edges) {
    const a = pos.get(e.from)!, b = pos.get(e.to)!;
    if (back.has(e) || e.from === e.to) {
      // Loops go around the outside edge of the drawing.
      const da = dims.get(e.from)!, db = dims.get(e.to)!;
      const side = across ? height - margin / 2 - loopRoom / 3 : width - margin / 2 - loopRoom / 3;
      const path = across
        ? `M${num(a.x)} ${num(a.y + da.h / 2)} L${num(a.x)} ${num(side)} L${num(b.x)} ${num(side)} L${num(b.x)} ${num(b.y + db.h / 2 + 2)}`
        : `M${num(a.x + da.w / 2)} ${num(a.y)} L${num(side)} ${num(a.y)} L${num(side)} ${num(b.y)} L${num(b.x + db.w / 2 + 2)} ${num(b.y)}`;
      drawn += `<path d="${path}" fill="none" stroke="${LINE}" stroke-width="1.3" stroke-dasharray="5 3" marker-end="url(#arrow)"/>` + label(e.label, across ? (a.x + b.x) / 2 : side, across ? side : (a.y + b.y) / 2);
      continue;
    }
    const start = edgePoint(e.from, b), end = edgePoint(e.to, a);
    // Straight when aligned; otherwise one elbow halfway along the flow.
    const aligned = across ? Math.abs(start.y - end.y) < 2 : Math.abs(start.x - end.x) < 2;
    let path: string, mid: { x: number; y: number };
    if (aligned) { path = `M${num(start.x)} ${num(start.y)} L${num(end.x)} ${num(end.y)}`; mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }; }
    else if (across) {
      const s = { x: a.x + dims.get(e.from)!.w / 2, y: a.y }, t = { x: b.x - dims.get(e.to)!.w / 2, y: b.y }, m = (s.x + t.x) / 2;
      path = `M${num(s.x)} ${num(s.y)} L${num(m)} ${num(s.y)} L${num(m)} ${num(t.y)} L${num(t.x)} ${num(t.y)}`; mid = { x: m, y: (s.y + t.y) / 2 };
    } else {
      const s = { x: a.x, y: a.y + dims.get(e.from)!.h / 2 }, t = { x: b.x, y: b.y - dims.get(e.to)!.h / 2 }, m = (s.y + t.y) / 2;
      path = `M${num(s.x)} ${num(s.y)} L${num(s.x)} ${num(m)} L${num(t.x)} ${num(m)} L${num(t.x)} ${num(t.y)}`; mid = { x: (s.x + t.x) / 2, y: m };
    }
    drawn += `<path d="${path}" fill="none" stroke="${LINE}" stroke-width="1.4" marker-end="url(#arrow)"/>` + label(e.label, mid.x, mid.y);
  }
  return svg(Math.max(width, 260), height, `<defs>${arrowDef()}</defs>${drawn}${nodes.map(shape).join("")}`, spec.title);
}

type Series = { name: string; values: number[] };
/** Bar (vertical or horizontal, grouped or stacked), line and pie charts with a real axis scale, legend and units. */
export function chart(spec: { title?: string; type?: "bar" | "hbar" | "stacked" | "line" | "pie"; labels: string[]; series: Series[]; xLabel?: string; yLabel?: string; unit?: string; width?: number; height?: number }) {
  const labels = list<string>(spec?.labels, "labels", 40).map(String), series = list<Series>(spec?.series, "series", 8);
  for (const s of series) {
    if (!Array.isArray(s?.values) || s.values.length !== labels.length) throw Error(`series "${s?.name}" needs exactly ${labels.length} values, one per label`);
    if (s.values.some((v) => typeof v !== "number" || !Number.isFinite(v))) throw Error(`series "${s?.name}" has a value that is not a number`);
  }
  const type = spec.type || "bar", W = Math.min(Math.max(spec.width || 640, 320), 1000), H = Math.min(Math.max(spec.height || 380, 220), 800);
  const unit = spec.unit ? " " + spec.unit : "";
  const legend = series.length > 1 || type === "pie";
  if (type === "pie") {
    const values = series[0].values, total = values.reduce((a, b) => a + Math.max(0, b), 0);
    if (!(total > 0)) throw Error("a pie chart needs positive values");
    const r = Math.min(H / 2 - 24, W / 3), cx = r + 30, cy = H / 2;
    let angle = -Math.PI / 2, body = "";
    values.forEach((v, i) => {
      const a = (Math.max(0, v) / total) * Math.PI * 2, end = angle + a, large = a > Math.PI ? 1 : 0;
      const p = (t: number, rr = r) => `${num(cx + rr * Math.cos(t))} ${num(cy + rr * Math.sin(t))}`;
      body += a >= Math.PI * 2 - 1e-6 ? `<circle cx="${cx}" cy="${cy}" r="${num(r)}" fill="${SERIES[i % SERIES.length]}"/>` : `<path d="M${cx} ${cy} L${p(angle)} A${num(r)} ${num(r)} 0 ${large} 1 ${p(end)} Z" fill="${SERIES[i % SERIES.length]}" stroke="${PAPER}" stroke-width="1.5"/>`;
      if (a > 0.25) body += textBlock([Math.round((v / total) * 100) + "%"], cx + r * 0.62 * Math.cos(angle + a / 2), cy + r * 0.62 * Math.sin(angle + a / 2), 12, { weight: 600, color: PAPER });
      angle = end;
    });
    const lx = cx + r + 40;
    labels.forEach((l, i) => { const y = cy - (labels.length * 22) / 2 + i * 22 + 11; body += `<rect x="${lx}" y="${num(y - 6)}" width="12" height="12" rx="2" fill="${SERIES[i % SERIES.length]}"/>` + textBlock([`${l} (${values[i]}${unit})`], lx + 20, y, 12, { anchor: "start" }); });
    return svg(W, H, body, spec.title);
  }
  const horizontal = type === "hbar", stacked = type === "stacked";
  const totals = labels.map((_, i) => series.reduce((s, x) => s + Math.max(0, x.values[i]), 0));
  const all = stacked ? [...totals, ...series.flatMap((s) => s.values.filter((v) => v < 0))] : series.flatMap((s) => s.values);
  let lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  if (lo === hi) hi = lo + 1;
  const step = (() => { const raw = (hi - lo) / 5, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag; })();
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const ticks: number[] = []; for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Math.round(t / step) * step);
  const tickText = (t: number) => (Math.abs(t) >= 1e6 ? (t / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : Math.abs(t) >= 1e4 ? (t / 1e3).toFixed(0) + "k" : String(+t.toPrecision(6)));
  const labelSpace = horizontal ? Math.min(160, Math.max(...labels.map((l) => textWidth(l, 11.5))) + 14) : 58;
  const left = horizontal ? labelSpace : 60, right = 20, top = legend ? 34 : 14, bottom = horizontal ? 42 : (labels.some((l) => textWidth(l, 11.5) > (W - 80) / labels.length - 6) ? 70 : 48);
  const pw = W - left - right, ph = H - top - bottom;
  const scale = (v: number) => ((v - lo) / (hi - lo)) * (horizontal ? pw : ph);
  let body = "";
  for (const t of ticks) {
    const at = scale(t);
    body += horizontal
      ? `<line x1="${num(left + at)}" y1="${top}" x2="${num(left + at)}" y2="${top + ph}" stroke="${t === 0 ? LINE : "#e3e6ea"}" stroke-width="${t === 0 ? 1.2 : 0.8}"/>` + textBlock([tickText(t)], left + at, top + ph + 14, 11, { color: MUTED })
      : `<line x1="${left}" y1="${num(top + ph - at)}" x2="${left + pw}" y2="${num(top + ph - at)}" stroke="${t === 0 ? LINE : "#e3e6ea"}" stroke-width="${t === 0 ? 1.2 : 0.8}"/>` + textBlock([tickText(t)], left - 8, top + ph - at, 11, { color: MUTED, anchor: "end" });
  }
  const band = (horizontal ? ph : pw) / labels.length;
  if (type === "line") {
    series.forEach((s, k) => {
      const pts = s.values.map((v, i) => ({ x: left + band * (i + 0.5), y: top + ph - scale(v) }));
      body += `<polyline points="${pts.map((p) => num(p.x) + "," + num(p.y)).join(" ")}" fill="none" stroke="${SERIES[k % SERIES.length]}" stroke-width="2.2" stroke-linejoin="round"/>` + pts.map((p) => `<circle cx="${num(p.x)}" cy="${num(p.y)}" r="3.4" fill="${PAPER}" stroke="${SERIES[k % SERIES.length]}" stroke-width="2"/>`).join("");
    });
  } else {
    labels.forEach((_, i) => {
      let base = 0;
      const inner = band * 0.72, each = stacked ? inner : inner / series.length;
      series.forEach((s, k) => {
        const v = s.values[i], from = stacked ? base : 0, to = stacked ? base + v : v;
        if (stacked) base += v;
        const a = scale(Math.min(from, to)), b = scale(Math.max(from, to)), offset = band * 0.14 + (stacked ? 0 : each * k);
        body += horizontal
          ? `<rect x="${num(left + a)}" y="${num(top + band * i + offset)}" width="${num(Math.max(0.5, b - a))}" height="${num(each - 2)}" rx="2" fill="${SERIES[k % SERIES.length]}"/>`
          : `<rect x="${num(left + band * i + offset)}" y="${num(top + ph - b)}" width="${num(each - 2)}" height="${num(Math.max(0.5, b - a))}" rx="2" fill="${SERIES[k % SERIES.length]}"/>`;
        if (!stacked && series.length === 1 && labels.length <= 16) body += horizontal ? textBlock([String(v) + unit], left + b + 6, top + band * i + offset + each / 2 - 1, 11, { color: INK, anchor: "start" }) : textBlock([String(v) + unit], left + band * i + offset + each / 2 - 1, top + ph - b - 9, 11, { color: INK });
      });
    });
  }
  labels.forEach((l, i) => {
    body += horizontal ? textBlock(wrap(l, labelSpace - 12, 11.5, 2), left - 8, top + band * (i + 0.5), 11.5, { anchor: "end" })
      : textBlock(wrap(l, Math.max(40, band - 6), 11.5, 3), left + band * (i + 0.5), top + ph + 18, 11.5);
  });
  if (spec.yLabel && !horizontal) body += `<text transform="translate(14 ${num(top + ph / 2)}) rotate(-90)" font-family="${FONT}" font-size="11.5" fill="${MUTED}" text-anchor="middle">${esc(spec.yLabel + (spec.unit && !spec.yLabel.includes(spec.unit) ? ` (${spec.unit})` : ""))}</text>`;
  if (spec.xLabel) body += textBlock([spec.xLabel], left + pw / 2, H - 10, 11.5, { color: MUTED });
  if (legend) { let x = left; series.forEach((s, k) => { body += `<rect x="${num(x)}" y="8" width="12" height="12" rx="2" fill="${SERIES[k % SERIES.length]}"/>` + textBlock([s.name], x + 18, 14, 12, { anchor: "start" }); x += textWidth(s.name, 12) + 42; }); }
  return svg(W, H, body, spec.title);
}

/** Dated events on one line, labels alternating above and below; many events switch to a vertical list. */
export function timeline(spec: { title?: string; events: { date: string; label: string; detail?: string }[]; width?: number }) {
  const events = list<{ date: string; label: string; detail?: string }>(spec?.events, "events", 30);
  if (events.length > 8) {
    const W = Math.min(Math.max(spec.width || 640, 420), 1000), rowH = (e: typeof events[number]) => 22 + wrap(e.label, W - 190, 12.5, 2).length * 16 + (e.detail ? wrap(e.detail, W - 190, 11.5, 3).length * 15 : 0);
    let y = 18, body = "";
    const heights = events.map(rowH), H = heights.reduce((a, b) => a + b, 0) + 30;
    body += `<line x1="130" y1="10" x2="130" y2="${H - 14}" stroke="${ACCENT}" stroke-width="2"/>`;
    events.forEach((e, i) => {
      body += `<circle cx="130" cy="${y + 8}" r="6" fill="${PAPER}" stroke="${ACCENT}" stroke-width="2.4"/>` + textBlock(wrap(e.date, 110, 12, 2), 116, y + 8, 12, { anchor: "end", weight: 600, color: ACCENT });
      const title = wrap(e.label, W - 190, 12.5, 2);
      body += textBlock(title, 150, y + 8 + ((title.length - 1) * 16) / 2, 12.5, { anchor: "start", weight: 600 });
      if (e.detail) { const d = wrap(e.detail, W - 190, 11.5, 3); body += textBlock(d, 150, y + 8 + title.length * 16 + ((d.length - 1) * 15) / 2 + 2, 11.5, { anchor: "start", color: MUTED }); }
      y += heights[i];
    });
    return svg(W, H, body, spec.title);
  }
  const W = Math.min(Math.max(spec.width || 680, 360), 1000), box = Math.min(150, (W - 40) / Math.max(1, events.length) * 1.7), pad = box / 2 + 10;
  const step = (W - pad * 2) / Math.max(1, events.length - 1), mid = 150;
  let body = `<line x1="16" y1="${mid}" x2="${W - 16}" y2="${mid}" stroke="${ACCENT}" stroke-width="2.4" marker-end="url(#tl)"/>`;
  events.forEach((e, i) => {
    const x = events.length === 1 ? W / 2 : pad + step * i, up = i % 2 === 0;
    const lines = wrap(e.label, box, 12, 3), detail = e.detail ? wrap(e.detail, box, 11, 3) : [];
    const block = lines.length * 15 + detail.length * 14;
    const cy = up ? mid - 28 - block / 2 - 14 : mid + 28 + block / 2 + 14;
    body += `<line x1="${num(x)}" y1="${mid}" x2="${num(x)}" y2="${num(up ? mid - 22 : mid + 22)}" stroke="${LINE}" stroke-width="1"/><circle cx="${num(x)}" cy="${mid}" r="6.5" fill="${PAPER}" stroke="${ACCENT}" stroke-width="2.6"/>`;
    body += textBlock([e.date], x, up ? mid - 30 - block - 6 : mid + 30, 12, { weight: 700, color: ACCENT });
    body += textBlock(lines, x, up ? mid - 22 - detail.length * 14 - (lines.length * 15) / 2 : mid + 46 + ((lines.length - 1) * 15) / 2, 12, { weight: 600 });
    if (detail.length) body += textBlock(detail, x, up ? mid - 20 - (detail.length * 14) / 2 : mid + 46 + lines.length * 15 + ((detail.length - 1) * 14) / 2, 11, { color: MUTED });
    void cy;
  });
  return svg(W, 300, `<defs>${arrowDef("tl", ACCENT)}</defs>${body}`, spec.title);
}

/** A repeating process drawn as a ring of steps with curved arrows (for example the water or cell cycle). */
export function cycle(spec: { title?: string; steps: { label: string; detail?: string }[]; center?: string; width?: number }) {
  const steps = list<{ label: string; detail?: string } | string>(spec?.steps, "steps", 12).map((s) => (typeof s === "string" ? { label: s } : s));
  const detailed = steps.some((s) => s.detail);
  const W = Math.min(Math.max(spec.width || (detailed ? 720 : 560), 360), 1000), H = Math.min(W * 0.8, 640), cx = W / 2, cy = H / 2 + 6;
  const n = steps.length, at = (i: number) => -Math.PI / 2 + (i / n) * Math.PI * 2;
  const room = detailed ? 150 : 16, R = Math.max(90, Math.min(W / 2 - 62 - room, H / 2 - 62 - (detailed ? 34 : 8)));
  let body = spec.center ? `<circle cx="${cx}" cy="${cy}" r="${num(R * 0.42)}" fill="#f3f6f9" stroke="#c9d6e3"/>` + textBlock(wrap(spec.center, R * 0.72, 13.5, 3), cx, cy, 13.5, { weight: 600, color: ACCENT }) : "";
  const nodeR = Math.min(62, (Math.PI * R) / n - 8);
  steps.forEach((s, i) => {
    const a = at(i), b = at(i + 1), gap = (nodeR + 6) / R;
    const p = (t: number) => `${num(cx + R * Math.cos(t))} ${num(cy + R * Math.sin(t))}`;
    body += `<path d="M${p(a + gap)} A${num(R)} ${num(R)} 0 0 1 ${p(b - gap)}" fill="none" stroke="${LINE}" stroke-width="1.8" marker-end="url(#cy)"/>`;
  });
  steps.forEach((s, i) => {
    const a = at(i), x = cx + R * Math.cos(a), y = cy + R * Math.sin(a), k = i % FILLS.length;
    body += `<circle cx="${num(x)}" cy="${num(y)}" r="${num(nodeR)}" fill="${FILLS[k]}" stroke="${STROKES[k]}" stroke-width="1.6"/>` + textBlock(wrap(s.label, nodeR * 1.6, 12, 3), x, y, 12, { weight: 600 });
    if (s.detail) {
      const vertical = Math.abs(Math.cos(a)) < 0.3, anchor = vertical ? "middle" : Math.cos(a) > 0 ? "start" : "end";
      const lines = wrap(s.detail, vertical ? 170 : 132, 11, 3), reach = nodeR + (vertical ? 10 + lines.length * 7 : 12);
      body += textBlock(lines, x + reach * Math.cos(a), y + reach * Math.sin(a), 11, { color: MUTED, anchor });
    }
  });
  return svg(W, H, `<defs>${arrowDef("cy")}</defs>${body}`, spec.title);
}

type Branch = { label: string; children?: (string | Branch)[] };
/** A topic in the middle with branches and their sub-points around it. */
export function mindMap(spec: { title?: string; center: string; branches: Branch[]; width?: number }) {
  if (typeof spec?.center !== "string") throw Error('mindMap needs "center"');
  const branches = list<Branch | string>(spec.branches, "branches", 10).map((b) => (typeof b === "string" ? { label: b } : b));
  const W = Math.min(Math.max(spec.width || 760, 480), 1100), H = Math.max(420, Math.min(900, 120 + branches.reduce((s, b) => s + Math.max(1, (b.children || []).length), 0) * 24));
  const cx = W / 2, cy = H / 2, n = branches.length;
  let body = "";
  const centerLines = wrap(spec.center, 150, 15, 3);
  branches.forEach((b, i) => {
    const a = -Math.PI / 2 + ((i + 0.5) / n) * Math.PI * 2, k = i % STROKES.length;
    const bx = cx + Math.cos(a) * W * 0.24, by = cy + Math.sin(a) * H * 0.3;
    body += `<path d="M${cx} ${cy} Q${num((cx + bx) / 2)} ${num(cy)} ${num(bx)} ${num(by)}" fill="none" stroke="${STROKES[k]}" stroke-width="2.4" opacity=".75"/>`;
    const lines = wrap(b.label, 120, 12.5, 2), bw = Math.max(...lines.map((l) => textWidth(l, 12.5))) + 22, bh = lines.length * 16 + 14;
    const kids = (b.children || []).slice(0, 8).map((c) => (typeof c === "string" ? c : c.label));
    const right = Math.cos(a) >= 0, kx = bx + (right ? bw / 2 + 26 : -bw / 2 - 26);
    kids.forEach((c, j) => {
      const ky = by + (j - (kids.length - 1) / 2) * 24;
      body += `<path d="M${num(bx + (right ? bw / 2 : -bw / 2))} ${num(by)} C${num(kx - (right ? 14 : -14))} ${num(by)} ${num(kx - (right ? 14 : -14))} ${num(ky)} ${num(kx)} ${num(ky)}" fill="none" stroke="${STROKES[k]}" stroke-width="1.2" opacity=".6"/>` +
        textBlock(wrap(c, 150, 11.5, 1), kx + (right ? 4 : -4), ky, 11.5, { anchor: right ? "start" : "end" });
    });
    body += `<rect x="${num(bx - bw / 2)}" y="${num(by - bh / 2)}" width="${num(bw)}" height="${num(bh)}" rx="${num(bh / 2)}" fill="${FILLS[k % FILLS.length]}" stroke="${STROKES[k]}" stroke-width="1.5"/>` + textBlock(lines, bx, by, 12.5, { weight: 600 });
  });
  const cw = Math.max(...centerLines.map((l) => textWidth(l, 15))) + 36, ch = centerLines.length * 19 + 22;
  body += `<rect x="${num(cx - cw / 2)}" y="${num(cy - ch / 2)}" width="${num(cw)}" height="${num(ch)}" rx="12" fill="${ACCENT}"/>` + textBlock(centerLines, cx, cy, 15, { weight: 600, color: PAPER });
  return svg(W, H, body, spec.title);
}

type TreeNode = { label: string; detail?: string; children?: TreeNode[] };
/** A hierarchy drawn top-down: classification trees, organisation charts, decision trees, taxonomies. */
export function tree(spec: { title?: string; root: TreeNode; width?: number }) {
  if (!spec?.root || typeof spec.root.label !== "string") throw Error('tree needs "root" with a "label"');
  let count = 0;
  const leaves = (n: TreeNode, depth: number): number => { if (++count > 60) throw Error("tree can have at most 60 nodes"); if (depth > 6) throw Error("tree can be at most 6 levels deep"); const kids = n.children || []; return kids.length ? kids.reduce((s, c) => s + leaves(c, depth + 1), 0) : 1; };
  const total = leaves(spec.root, 0);
  const boxW = 128, gapX = 14, levelH = 96, W = Math.max(total * (boxW + gapX) + 40, 300);
  let depthMax = 0, body = "";
  const place = (n: TreeNode, depth: number, from: number): { x: number; y: number; w: number; h: number } => {
    depthMax = Math.max(depthMax, depth);
    const kids = n.children || [], y = 30 + depth * levelH;
    let x: number, cursor = from;
    const placed = kids.map((c) => { const p = place(c, depth + 1, cursor); cursor += leaves2(c) * (boxW + gapX); return p; });
    x = placed.length ? (placed[0].x + placed[placed.length - 1].x) / 2 : from + boxW / 2;
    const lines = wrap(n.label, boxW - 14, 12, 3), detail = n.detail ? wrap(n.detail, boxW - 14, 10.5, 2) : [];
    const h = lines.length * 15 + detail.length * 13 + 16, k = depth % STROKES.length;
    for (const p of placed) body += `<path d="M${num(x)} ${num(y + h)} L${num(x)} ${num(y + h + (p.y - y - h) / 2)} L${num(p.x)} ${num(y + h + (p.y - y - h) / 2)} L${num(p.x)} ${num(p.y)}" fill="none" stroke="${LINE}" stroke-width="1.2"/>`;
    body += `<rect x="${num(x - boxW / 2)}" y="${y}" width="${boxW}" height="${num(h)}" rx="6" fill="${depth ? FILLS[k] : ACCENT}" stroke="${STROKES[k]}" stroke-width="1.3"/>` +
      textBlock(lines, x, y + 8 + (lines.length * 15) / 2, 12, { weight: 600, color: depth ? INK : PAPER }) +
      (detail.length ? textBlock(detail, x, y + 10 + lines.length * 15 + (detail.length * 13) / 2, 10.5, { color: depth ? MUTED : "#dbe6f1" }) : "");
    return { x, y, w: boxW, h };
  };
  const leavesMemo = new Map<TreeNode, number>();
  const leaves2 = (n: TreeNode): number => { if (!leavesMemo.has(n)) leavesMemo.set(n, (n.children || []).length ? (n.children || []).reduce((s, c) => s + leaves2(c), 0) : 1); return leavesMemo.get(n)!; };
  place(spec.root, 0, 20 + gapX / 2);
  return svg(W, 30 + (depthMax + 1) * levelH, body, spec.title);
}

/** Two or three overlapping sets, with what belongs only to each and what they share. */
export function venn(spec: { title?: string; sets: { label: string; items?: string[] }[]; overlap?: string[]; overlaps?: Record<string, string[]>; width?: number }) {
  const sets = list<{ label: string; items?: string[] }>(spec?.sets, "sets", 3);
  if (sets.length < 2) throw Error("venn needs 2 or 3 sets");
  const W = Math.min(Math.max(spec.width || 620, 420), 900), three = sets.length === 3, H = three ? W * 0.82 : W * 0.6;
  const r = three ? W * 0.24 : W * 0.27, cx = W / 2, cy = three ? H * 0.46 : H / 2;
  const centers = three ? [{ x: cx - r * 0.62, y: cy - r * 0.32 }, { x: cx + r * 0.62, y: cy - r * 0.32 }, { x: cx, y: cy + r * 0.62 }] : [{ x: cx - r * 0.62, y: cy }, { x: cx + r * 0.62, y: cy }];
  let body = centers.map((c, i) => `<circle cx="${num(c.x)}" cy="${num(c.y)}" r="${num(r)}" fill="${STROKES[i]}" fill-opacity=".13" stroke="${STROKES[i]}" stroke-width="1.6"/>`).join("");
  centers.forEach((c, i) => {
    const away = three ? { x: c.x + (c.x - cx) * 0.55, y: c.y + (c.y - cy) * 0.55 } : { x: c.x + (c.x - cx) * 0.62, y: c.y };
    const labelY = three ? (i === 2 ? c.y + r + 18 : c.y - r - 12) : c.y - r - 12;
    body += textBlock(wrap(sets[i].label, r * 1.4, 13.5, 2), c.x, labelY, 13.5, { weight: 700, color: STROKES[i] });
    body += textBlock((sets[i].items || []).slice(0, 6).flatMap((t) => wrap(t, r * 0.72, 11.5, 2)), away.x, away.y, 11.5);
  });
  const shared = spec.overlap || spec.overlaps?.all || spec.overlaps?.[sets.map((_, i) => "ABC"[i]).join("")] || [];
  body += textBlock(shared.slice(0, 5).flatMap((t) => wrap(t, r * (three ? 0.5 : 0.62), 11.5, 2)), cx, three ? cy + r * 0.02 : cy, 11.5, { weight: 600 });
  if (three && spec.overlaps) {
    const pairs: [string, number, number][] = [["AB", 0, 1], ["AC", 0, 2], ["BC", 1, 2]];
    for (const [key, a, b] of pairs) {
      const items = spec.overlaps[key] || [];
      if (!items.length) continue;
      const m = { x: (centers[a].x + centers[b].x) / 2, y: (centers[a].y + centers[b].y) / 2 }, out = { x: m.x + (m.x - cx) * 0.9, y: m.y + (m.y - cy) * 0.9 };
      body += textBlock(items.slice(0, 3).flatMap((t) => wrap(t, r * 0.5, 11, 1)), out.x, out.y, 11);
    }
  }
  return svg(W, H + (three ? 20 : 0), body, spec.title);
}
