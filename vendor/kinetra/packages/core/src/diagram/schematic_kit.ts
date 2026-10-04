/**
 * Drawing kit shared by the circuit renderers: textbook symbols drawn at a fixed pixel size along any axis,
 * upright polarity marks, label text with subscripts, value formatting, junction dots, and a label placer
 * that keeps every label clear of wires, symbols, other labels and the frame.
 */

export type Pt = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };
export type Seg = { a: Pt; b: Pt };

export const INK = "#1b1d21";
export const FONT = "'Mowafy Sans','Segoe UI',Arial,Helvetica,sans-serif";
export const LABEL_SIZE = 13;
export const LINE_H = 16;
/** The gap every label keeps from any stroke, symbol, other label or the frame. */
export const CLEAR = 7;
const STROKE = 1.6;

export const num = (n: number) => (Math.round(n * 100) / 100).toString();
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// --- Text --------------------------------------------------------------------

type Run = { t: string; sub: boolean };
/** "i_o", "V_{th}" and "R_1" become a normal run and a subscript run; "$…$" math markers are dropped. */
export function runs(label: string): Run[] {
  const s = label.replace(/\$/g, "");
  const out: Run[] = [];
  let buf = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "_" && i + 1 < s.length) {
      const close = s[i + 1] === "{" ? s.indexOf("}", i + 2) : -1;
      const word = close > 0 ? s.slice(i + 2, close) : /^[A-Za-z0-9]+/.exec(s.slice(i + 1))?.[0];
      if (word) {
        if (buf) out.push({ t: buf, sub: false });
        buf = "";
        out.push({ t: word, sub: true });
        i = close > 0 ? close : i + word.length;
        continue;
      }
    }
    buf += s[i];
  }
  if (buf) out.push({ t: buf, sub: false });
  return out;
}
const glyph = (c: string) =>
  /[ilj.,:;'|!()[\]]/.test(c) ? 0.3 : /[frtI ]/.test(c) ? 0.38 : /[mwMWΩ@]/.test(c) ? 0.9 : /[A-Z0-9µ+−=]/.test(c) ? 0.66 : 0.56;
/** A generous width estimate (the widest common UI and book faces), so measured clearances hold in any of them. */
export function textWidth(label: string, size = LABEL_SIZE) {
  const parts = runs(label);
  const glyphs = parts.reduce((w, r) => w + [...r.t].reduce((a, c) => a + glyph(c), 0) * (r.sub ? size * 0.72 : size), 0) * 1.08;
  // Never narrower than a plain 0.62 em per character, so wide book faces keep their clearance too.
  return Math.max(glyphs, parts.reduce((w, r) => w + [...r.t].length * (r.sub ? size * 0.72 : size) * 0.62, 0));
}
/** One line of label text with its baseline at y. */
export function richText(x: number, y: number, label: string, anchor: "start" | "middle" | "end" = "middle", size = LABEL_SIZE) {
  let dy = 0, body = "";
  for (const r of runs(label)) {
    const shift = r.sub ? size * 0.28 : 0;
    body += `<tspan${r.sub ? ` font-size="${num(size * 0.72)}"` : ""}${shift !== dy ? ` dy="${num(shift - dy)}"` : ""}>${esc(r.t)}</tspan>`;
    dy = shift;
  }
  return `<text x="${num(x)}" y="${num(y)}" font-family="${FONT}" font-size="${size}" fill="${INK}" text-anchor="${anchor}">${body}</text>`;
}
/** A block of label lines laid out in box b; the anchor follows the side of the drawing it sits on. */
export function textBlock(b: Box, lines: string[], anchor: "start" | "middle" | "end") {
  const x = anchor === "start" ? b.x : anchor === "end" ? b.x + b.w : b.x + b.w / 2;
  return lines.map((l, i) => richText(x, b.y + i * LINE_H + LABEL_SIZE * 0.95, l, anchor)).join("");
}
export const blockSize = (lines: string[]) => ({ w: Math.max(0, ...lines.map((l) => textWidth(l))), h: lines.length * LINE_H });

// --- Values ------------------------------------------------------------------

const trim = (v: number) => Number(v.toPrecision(4)).toString();
/** "ohm", "kohm", "ohms" → Ω, kΩ; "uF" → µF. */
export const unitText = (unit = "") =>
  unit.trim().replace(/^([kKMmGµu]?)ohms?$/i, (_, p) => (p === "K" ? "k" : p === "u" ? "µ" : p) + "Ω").replace(/^u(?=[A-Za-z])/, "µ");
const PREFIX: [number, string][] = [[1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"]];
/** 1000 Ω → "1 kΩ", 0.002 A → "2 mA"; a unit that already has a prefix ("kΩ", "mA") is kept as given. */
export function formatValue(value: number, unit?: string) {
  const u = unitText(unit);
  if (!u) return trim(value);
  const a = Math.abs(value);
  if (a === 0 || (u.length > 1 && /^[GMkmµnp]/.test(u) && !/^(min|mol|mmHg)$/.test(u))) return `${trim(value)} ${u}`;
  for (const [f, p] of PREFIX) if (a >= f * 0.99995) return `${trim(value / f)} ${p}${u}`;
  return `${trim(value)} ${u}`;
}
const valueLike = (s: string) => /^[-+]?\d*\.?\d+(e-?\d+)?\s*[GMkKmµunp]?\s*(ohms?|Ω|V|A|F|H|S|W|Hz)?$/i.test(s.trim());
/**
 * The lines printed beside a component. A label that only repeats the value ("4 ohm" with value 4) prints the value
 * once; a name prints above its value ("R1", "4 Ω"); comma-separated parts ("1 k, V_x") become separate lines.
 */
export function labelLines(label: string | undefined, value: number | undefined, unit: string | undefined): string[] {
  const val = value != null && Number.isFinite(value) ? formatValue(value, unit) : "";
  const parts = String(label ?? "").split(/\n|,\s*/).map((p) => p.trim().replace(/(\d)\s*([kKMmµu]?)ohms?\b/gi, (_, d, p) => `${d} ${unitText(p + "ohm")}`)).filter(Boolean);
  if (!val) return parts;
  const names = parts.filter((p) => !valueLike(p));
  // A part such as "R1 = 4 Ω" already states the value.
  if (names.some((p) => /=/.test(p) && p.includes(trim(value!)))) return names;
  return [...names, val];
}

// --- Geometry ----------------------------------------------------------------

export const inflate = (b: Box, d: number): Box => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d });
export const segBox = (s: Seg): Box => ({ x: Math.min(s.a.x, s.b.x), y: Math.min(s.a.y, s.b.y), w: Math.abs(s.a.x - s.b.x), h: Math.abs(s.a.y - s.b.y) });
export function overlapArea(a: Box, b: Box) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
/** Whether two boxes come closer than `gap` (touching edges count as intersecting when gap > 0). */
export const near = (a: Box, b: Box, gap = 0) => !(a.x + a.w + gap <= b.x || b.x + b.w + gap <= a.x || a.y + a.h + gap <= b.y || b.y + b.h + gap <= a.y);
/** The distance from a box to a segment (0 when they touch). */
export function boxSegDistance(b: Box, s: Seg) {
  const sb = segBox(s);
  const dx = Math.max(0, b.x - (sb.x + sb.w), sb.x - (b.x + b.w)), dy = Math.max(0, b.y - (sb.y + sb.h), sb.y - (b.y + b.h));
  if (s.a.x === s.b.x || s.a.y === s.b.y) return Math.hypot(dx, dy);
  // A slanted segment: sample it (only manual figures can still contain one).
  let best = Infinity;
  for (let i = 0; i <= 40; i++) {
    const p = { x: s.a.x + ((s.b.x - s.a.x) * i) / 40, y: s.a.y + ((s.b.y - s.a.y) * i) / 40 };
    best = Math.min(best, Math.hypot(Math.max(0, b.x - p.x, p.x - b.x - b.w), Math.max(0, b.y - p.y, p.y - b.y - b.h)));
  }
  return best;
}
const same = (p: Pt, q: Pt) => Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5;
/** Whether p lies strictly inside segment s (not at an end). */
function inside(p: Pt, s: Seg) {
  if (same(p, s.a) || same(p, s.b)) return false;
  if (Math.abs(s.a.x - s.b.x) < 0.5) return Math.abs(p.x - s.a.x) < 0.5 && p.y > Math.min(s.a.y, s.b.y) && p.y < Math.max(s.a.y, s.b.y);
  if (Math.abs(s.a.y - s.b.y) < 0.5) return Math.abs(p.y - s.a.y) < 0.5 && p.x > Math.min(s.a.x, s.b.x) && p.x < Math.max(s.a.x, s.b.x);
  return false;
}
/** Junction dots: every point where three or more wire ends meet, or a wire ends on another wire's span. */
export function junctions(segments: Seg[], extra: Pt[] = []): Pt[] {
  const ends = [...segments.flatMap((s) => [s.a, s.b]), ...extra];
  const dots: Pt[] = [];
  for (const p of ends) {
    if (dots.some((d) => same(d, p))) continue;
    const count = ends.filter((q) => same(p, q)).length + 2 * segments.filter((s) => inside(p, s)).length;
    if (count >= 3) dots.push(p);
  }
  return dots;
}

// --- Symbols -----------------------------------------------------------------

export type SymbolKind =
  | "resistor" | "capacitor" | "inductor" | "voltage-source" | "current-source" | "dependent-voltage-source" | "dependent-current-source"
  | "ac-source" | "battery" | "switch" | "diode" | "led" | "lamp" | "ammeter" | "voltmeter" | "wire";
export const SYMBOLS: SymbolKind[] = ["resistor", "capacitor", "inductor", "voltage-source", "current-source", "dependent-voltage-source", "dependent-current-source", "ac-source", "battery", "switch", "diode", "led", "lamp", "ammeter", "voltmeter", "wire"];
const ALIASES: Record<string, SymbolKind> = {
  r: "resistor", res: "resistor", c: "capacitor", cap: "capacitor", l: "inductor", coil: "inductor",
  v: "voltage-source", vs: "voltage-source", "dc-source": "voltage-source", "voltage source": "voltage-source", source: "voltage-source",
  i: "current-source", cs: "current-source", "current source": "current-source",
  vcvs: "dependent-voltage-source", ccvs: "dependent-voltage-source", "dependent-voltage": "dependent-voltage-source", "controlled-voltage-source": "dependent-voltage-source",
  vccs: "dependent-current-source", cccs: "dependent-current-source", "dependent-current": "dependent-current-source", "controlled-current-source": "dependent-current-source",
  ac: "ac-source", "sine-source": "ac-source", cell: "battery", bulb: "lamp", short: "wire",
};
export function symbolKind(kind: string): SymbolKind {
  const k = String(kind ?? "").trim().toLowerCase();
  if ((SYMBOLS as string[]).includes(k)) return k as SymbolKind;
  if (ALIASES[k]) return ALIASES[k];
  throw Error(`unsupported component kind "${kind}"; use one of ${SYMBOLS.join(", ")}`);
}
/** Half the symbol's length along its axis (where its leads attach) and half its thickness across it. */
export const SIZE: Record<SymbolKind, { half: number; thick: number }> = {
  resistor: { half: 24, thick: 8 }, capacitor: { half: 5, thick: 15 }, inductor: { half: 24, thick: 8 },
  "voltage-source": { half: 17, thick: 17 }, "current-source": { half: 17, thick: 17 }, "ac-source": { half: 17, thick: 17 },
  "dependent-voltage-source": { half: 19, thick: 19 }, "dependent-current-source": { half: 19, thick: 19 },
  battery: { half: 5, thick: 15 }, switch: { half: 17, thick: 14 }, diode: { half: 10, thick: 11 }, led: { half: 10, thick: 18 },
  lamp: { half: 14, thick: 14 }, ammeter: { half: 14, thick: 14 }, voltmeter: { half: 14, thick: 14 }, wire: { half: 0, thick: 0 },
};

/**
 * One symbol centred at c along unit axis e (pin 0 → pin 1). Local u runs along e, w across it (the side w < 0 is
 * the left of the direction of travel). Voltage sources put + toward pin 1; current sources and diodes point to pin 1.
 * Polarity marks and meter letters stay upright whatever the axis. `scale` shrinks a symbol between close pins.
 */
export function drawSymbol(kind: SymbolKind, c: Pt, e: Pt, scale = 1, opts: { closed?: boolean } = {}): { svg: string; box: Box } {
  const n = { x: -e.y, y: e.x };
  const P = (u: number, w: number): Pt => ({ x: c.x + (u * e.x + w * n.x) * scale, y: c.y + (u * e.y + w * n.y) * scale });
  const poly = (pts: [number, number][], close = false, fill = "none", width = STROKE) =>
    `<path d="${pts.map(([u, w], i) => { const p = P(u, w); return `${i ? "L" : "M"}${num(p.x)} ${num(p.y)}`; }).join(" ")}${close ? " Z" : ""}" fill="${fill}" stroke="${INK}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"/>`;
  const circle = (r: number, fill = "#fff") => { const p = P(0, 0); return `<circle cx="${num(p.x)}" cy="${num(p.y)}" r="${num(r * scale)}" fill="${fill}" stroke="${INK}" stroke-width="${STROKE}"/>`; };
  // Upright marks: a + or − centred at local (u, w), drawn in screen axes.
  const mark = (u: number, w: number, plus: boolean, k = 4) => {
    const p = P(u, w), s = k * scale;
    return `<path d="M${num(p.x - s)} ${num(p.y)} H${num(p.x + s)}${plus ? ` M${num(p.x)} ${num(p.y - s)} V${num(p.y + s)}` : ""}" stroke="${INK}" stroke-width="1.4" stroke-linecap="round"/>`;
  };
  const letter = (t: string) => { const p = P(0, 0); return `<text class="glyph" x="${num(p.x)}" y="${num(p.y + 5 * scale)}" font-family="${FONT}" font-size="${num(14 * scale)}" font-weight="600" fill="${INK}" text-anchor="middle">${t}</text>`; };
  const arrow = (from: number, to: number) => poly([[from, 0], [to, 0]]) + poly([[to, 0], [to - 7, -4.5], [to - 7, 4.5]], true, INK);
  const { half, thick } = SIZE[kind];
  let svg = "";
  switch (kind) {
    case "resistor": svg = poly([[-24, 0], [-20, -7], [-12, 7], [-4, -7], [4, 7], [12, -7], [20, 7], [24, 0]]); break;
    case "capacitor": svg = poly([[-5, -14], [-5, 14]]) + poly([[5, -14], [5, 14]]); break;
    case "inductor": {
      const pts: [number, number][] = [];
      for (let k = 0; k < 4; k++) for (let i = 0; i <= 10; i++) { const a = Math.PI - (Math.PI * i) / 10; pts.push([-24 + 12 * k + 6 + 6 * Math.cos(a), -6 * Math.sin(a)]); }
      svg = poly(pts); break;
    }
    case "voltage-source": svg = circle(17) + mark(8, 0, true) + mark(-8, 0, false); break;
    case "ac-source": {
      const pts: [number, number][] = [];
      for (let i = 0; i <= 16; i++) pts.push([-9 + (18 * i) / 16, -5 * Math.sin((Math.PI * 2 * i) / 16)]);
      svg = circle(17) + poly(pts); break;
    }
    case "current-source": svg = circle(17) + arrow(-10, 10); break;
    case "dependent-voltage-source": svg = poly([[-19, 0], [0, -19], [19, 0], [0, 19]], true, "#fff") + mark(8, 0, true) + mark(-8, 0, false); break;
    case "dependent-current-source": svg = poly([[-19, 0], [0, -19], [19, 0], [0, 19]], true, "#fff") + arrow(-10, 10); break;
    case "battery": svg = poly([[5, -14], [5, 14]]) + poly([[-5, -7], [-5, 7]], false, "none", 3.2); break;
    case "switch": {
      const a = P(-14, 0), b = P(14, 0);
      svg = `<circle cx="${num(a.x)}" cy="${num(a.y)}" r="${num(2.6 * scale)}" fill="#fff" stroke="${INK}" stroke-width="1.4"/><circle cx="${num(b.x)}" cy="${num(b.y)}" r="${num(2.6 * scale)}" fill="#fff" stroke="${INK}" stroke-width="1.4"/>` +
        poly([[-17, 0], [-14, 0]]) + poly([[14, 0], [17, 0]]) + poly(opts.closed ? [[-12, 0], [12, 0]] : [[-12, -1], [12, -12]]);
      break;
    }
    case "diode": case "led":
      svg = poly([[-10, -10], [-10, 10], [8, 0]], true, kind === "led" ? "#fff" : INK) + poly([[8, -10], [8, 10]]) + poly([[-10, 0], [8, 0]]) + poly([[8, 0], [10, 0]]);
      if (kind === "led") svg += poly([[-2, -12], [5, -19]]) + poly([[5, -19], [1, -18], [4, -15]], true, INK) + poly([[4, -12], [11, -19]]) + poly([[11, -19], [7, -18], [10, -15]], true, INK);
      break;
    case "lamp": svg = circle(14) + poly([[-10, -10], [10, 10]]) + poly([[-10, 10], [10, -10]]); break;
    case "ammeter": svg = circle(14) + letter("A"); break;
    case "voltmeter": svg = circle(14) + letter("V"); break;
    case "wire": svg = ""; break;
  }
  const corners = [P(-half, -thick), P(half, -thick), P(-half, thick), P(half, thick)];
  const x = Math.min(...corners.map((p) => p.x)), y = Math.min(...corners.map((p) => p.y));
  return { svg, box: { x, y, w: Math.max(...corners.map((p) => p.x)) - x, h: Math.max(...corners.map((p) => p.y)) - y } };
}
/** The pin-side ends of a symbol's body along its axis, where the leads stop. */
export const bodyEnds = (kind: SymbolKind, c: Pt, e: Pt, scale = 1): [Pt, Pt] => {
  const h = SIZE[kind].half * scale;
  return [{ x: c.x - e.x * h, y: c.y - e.y * h }, { x: c.x + e.x * h, y: c.y + e.y * h }];
};
/** Earth symbol hanging below p. */
export function groundSymbol(p: Pt): { svg: string; box: Box; stem: Seg } {
  const y = p.y + 14;
  const l = (x1: number, x2: number, yy: number) => `<path d="M${num(p.x + x1)} ${num(yy)} H${num(p.x + x2)}" stroke="${INK}" stroke-width="${STROKE}" stroke-linecap="round"/>`;
  return { svg: `<path d="M${num(p.x)} ${num(p.y)} V${num(y)}" stroke="${INK}" stroke-width="${STROKE}"/>` + l(-13, 13, y) + l(-8, 8, y + 5) + l(-3.5, 3.5, y + 10),
    box: { x: p.x - 13, y: p.y, w: 26, h: 24 }, stem: { a: p, b: { x: p.x, y } } };
}
/** A small filled arrowhead at the middle of a straight lead, pointing along d. */
export function leadArrow(mid: Pt, d: Pt) {
  const n = { x: -d.y, y: d.x }, tip = { x: mid.x + d.x * 5, y: mid.y + d.y * 5 };
  const b1 = { x: tip.x - d.x * 10 + n.x * 4.5, y: tip.y - d.y * 10 + n.y * 4.5 }, b2 = { x: tip.x - d.x * 10 - n.x * 4.5, y: tip.y - d.y * 10 - n.y * 4.5 };
  return { svg: `<path d="M${num(tip.x)} ${num(tip.y)} L${num(b1.x)} ${num(b1.y)} L${num(b2.x)} ${num(b2.y)} Z" fill="${INK}"/>`, box: { x: Math.min(tip.x, b1.x, b2.x), y: Math.min(tip.y, b1.y, b2.y), w: Math.max(tip.x, b1.x, b2.x) - Math.min(tip.x, b1.x, b2.x), h: Math.max(tip.y, b1.y, b2.y) - Math.min(tip.y, b1.y, b2.y) } };
}
export const wirePath = (segments: Seg[]) =>
  segments.length ? `<path d="${segments.map((s) => `M${num(s.a.x)} ${num(s.a.y)} L${num(s.b.x)} ${num(s.b.y)}`).join(" ")}" fill="none" stroke="${INK}" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round"/>` : "";
export const dotSvg = (p: Pt) => `<circle cx="${num(p.x)}" cy="${num(p.y)}" r="3.4" fill="${INK}"/>`;

// --- Label placement ---------------------------------------------------------

export type Candidate = { box: Box; anchor: "start" | "middle" | "end"; cost: number };
export type Scene = { segments: Seg[]; boxes: Box[]; labels: Box[]; frame: Box };
/** How badly a label box would collide: anything closer than CLEAR to a stroke, symbol or label, or outside the frame. */
export function collision(b: Box, scene: Scene, ignore: Box[] = []) {
  let cost = 0;
  const f = inflate(scene.frame, -4);
  const outside = b.w * b.h - overlapArea(b, f);
  if (outside > 0.5) cost += 5000 + outside * 50;
  for (const s of scene.segments) {
    const d = boxSegDistance(b, s);
    if (d < CLEAR) cost += 1500 + (CLEAR - d) * 200;
  }
  for (const o of [...scene.boxes, ...scene.labels]) {
    if (ignore.includes(o)) continue;
    if (near(b, o, CLEAR)) cost += 1500 + overlapArea(inflate(b, CLEAR), o) * 20;
  }
  return cost;
}
/** The candidate with the least collision (ties go to the earlier, preferred one). The chosen box joins scene.labels. */
export function place(cands: Candidate[], scene: Scene, ignore: Box[] = []): Candidate {
  let best = cands[0], score = Infinity;
  for (const c of cands) {
    const s = c.cost + collision(c.box, scene, ignore);
    if (s < score - 1e-9) { best = c; score = s; }
  }
  scene.labels.push(best.box);
  return best;
}
/**
 * Label candidates around a symbol with centre c, axis e and half-thickness t: both sides across the axis
 * (preferred side first), stepping outward and sliding along the axis, then beyond each end.
 */
export function aroundSymbol(c: Pt, e: Pt, t: number, half: number, size: { w: number; h: number }, prefer: 1 | -1 = 1): Candidate[] {
  const out: Candidate[] = [];
  const horizontal = Math.abs(e.x) >= Math.abs(e.y);
  for (const side of [prefer, -prefer as 1 | -1]) {
    for (const [k, step] of [0, 8, 18, 32].entries()) {
      for (const [j, slide] of [0, 0.5, -0.5, 1, -1].entries()) {
        const along = slide * Math.max(half, 12);
        if (horizontal) {
          // Above (side 1) or below (side −1) a horizontal symbol, centred.
          const cx = c.x + along * Math.sign(e.x || 1), y = side === 1 ? c.y - t - CLEAR - step - size.h : c.y + t + CLEAR + step;
          out.push({ box: { x: cx - size.w / 2, y, w: size.w, h: size.h }, anchor: "middle", cost: (side === prefer ? 0 : 6) + k * 4 + j * 2 });
        } else {
          // Right (side 1) or left (side −1) of a vertical symbol, vertically centred.
          const cy = c.y + along * Math.sign(e.y || 1), x = side === 1 ? c.x + t + CLEAR + step : c.x - t - CLEAR - step - size.w;
          out.push({ box: { x, y: cy - size.h / 2, w: size.w, h: size.h }, anchor: side === 1 ? "start" : "end", cost: (side === prefer ? 0 : 6) + k * 4 + j * 2 });
        }
      }
    }
  }
  return out;
}
