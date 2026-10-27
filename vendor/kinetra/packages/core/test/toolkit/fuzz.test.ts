/**
 * Seeded fuzz: N random valid compositions of basic shapes, laid out in a
 * grid of cells with random relation styles, unit expressions, labels, title
 * and caption. Each must compose with 0 collisions, 0 out-of-bounds and 0
 * non-finite values, conform to the style contract, and pass an independent
 * oracle that re-measures labels and lines from the SVG text itself. A
 * negative arm duplicates one element per case (no mayTouch) and requires
 * E_COLLISION.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkToolkitStyle, compose } from "../../src/toolkit/index.js";
import type { ComposeModel, ElementSpec, NumLike } from "../../src/toolkit/index.js";

export const FUZZ_SEED = 20261027;
export const FUZZ_CASES = 320;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const LABELS = ["A", "B", "F", "m", "v_0", "θ", "\\alpha", "T_1", "x^2", "N", "mg", "P(1, 2)", "load", "F = 12 N", "\\omega_0"];
const FILLS = ["none", "bodyFill", "mechanismFill", "surfaceFill"];
const COLORS = ["ink", "force", "normal", "friction", "velocity", "body", "rayAlt"];

export function generate(seed: number, k: number): ComposeModel {
  const r = rng(seed * 7919 + k);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const between = (a: number, b: number) => a + (b - a) * r();
  const round = (x: number) => Math.round(x * 1000) / 1000;
  const fmt = (x: number): NumLike => { const v = round(x); const s = r(); return s < 0.5 ? v : s < 0.75 ? String(v) : s < 0.9 ? `${v} m` : `${round(v * 100)} cm`; };
  const cols = 2 + Math.floor(r() * 3), rows = 2 + Math.floor(r() * 2);
  const s = between(38, 52), pad = 0.9;
  const world = { xMin: 0, xMax: cols * 4, yMin: -pad, yMax: rows * 3 + pad };
  const canvas = { width: Math.round(cols * 4 * s), height: Math.round((rows * 3 + 2 * pad) * s), world };
  const elements: ElementSpec[] = [];
  let usesForce = false;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    if (r() < 0.12) continue; // some empty cells
    const cx = i * 4 + 2, cy = j * 3 + 1.5, id = `e${i}_${j}`;
    const style = Math.floor(r() * 5);
    const place = (): Pick<ElementSpec, "at" | "place" | "prefer"> => {
      const d = round(between(0.5, 1.5));
      switch (style) {
        case 0: return { at: { x: fmt(cx), y: fmt(cy) } };
        case 1: return { place: [{ x: fmt(cx) }, { y: fmt(cy) }] };
        case 2: return { place: { along: { from: { x: cx - d, y: cy }, angle: 0, distance: fmt(d) } } };
        case 3: return { place: [{ alignedWith: { x: cx, y: -5 }, axis: "x" }, { y: fmt(cy) }] };
        default: return { place: [{ distance: fmt(d), from: { x: cx, y: cy - d } }, { x: fmt(cx) }], prefer: "above" };
      }
    };
    const kind = pick(["rect", "block", "circle", "point", "segment", "arrow", "force", "polygon", "arc", "text", "polyline", "curve"] as const);
    const ang = round(between(0, 360)), u = { x: Math.cos(ang * Math.PI / 180), y: Math.sin(ang * Math.PI / 180) };
    let el: ElementSpec;
    switch (kind) {
      case "rect": el = { id, type: "rect", w: fmt(between(0.6, 1.4)), h: fmt(between(0.4, 0.9)), rotation: round(between(0, 40)), fill: pick(FILLS), ...place() }; break;
      case "block": el = { id, type: "block", w: fmt(between(0.8, 1.4)), h: fmt(between(0.5, 0.9)), ...place() }; break;
      case "circle": el = { id, type: "circle", r: fmt(between(0.3, 0.8)), fill: pick(FILLS), ...place() }; break;
      case "point": el = { id, type: "point", color: pick(COLORS), ...place() }; break;
      case "text": el = { id, type: "text", text: pick(LABELS), size: pick([11, 12, 13] as const), ...place() }; break;
      case "arc": el = { id, type: "arc", r: fmt(between(0.4, 0.8)), from: ang, to: round(ang + between(40, 200)), width: pick([1, 1.2, 1.6]), ...place() }; break;
      case "segment": { const h = between(0.5, 0.9); el = { id, type: "segment", from: { x: round(cx - u.x * h), y: round(cy - u.y * h) }, to: { x: round(cx + u.x * h), y: round(cy + u.y * h) }, width: pick([1, 1.6, 2]), dashed: r() < 0.3, color: pick(COLORS) }; break; }
      case "arrow": { const h = between(0.5, 0.9); el = { id, type: "arrow", from: { x: round(cx - u.x * h), y: round(cy - u.y * h) }, angle: `${ang} deg`, length: fmt(2 * h), color: pick(COLORS) }; break; }
      case "force": { const mag = round(between(9, 16)); usesForce = true; el = { id, type: "force", from: { x: round(cx - u.x * mag / 20), y: round(cy - u.y * mag / 20) }, angle: ang, magnitude: `${mag} N` }; break; }
      case "polygon": { const rad = between(0.5, 0.8); el = { id, type: "polygon", points: [0, 1, 2].map(n => ({ x: round(cx + rad * Math.cos(ang * Math.PI / 180 + n * 2.1)), y: round(cy + rad * Math.sin(ang * Math.PI / 180 + n * 2.1)) })), fill: pick(FILLS) }; break; }
      case "polyline": el = { id, type: "polyline", points: [{ x: round(cx - 0.8), y: round(cy - 0.4) }, { x: round(cx - 0.2), y: round(cy + 0.5) }, { x: round(cx + 0.3), y: round(cy - 0.3) }, { x: round(cx + 0.8), y: round(cy + 0.4) }], width: pick([1, 1.6]) }; break;
      case "curve": { const a = round(between(0.5, 1.2)); el = { id, type: "curve", fn: `${a}*(x - ${cx})^2 + ${round(cy - 0.6)}`, domain: [round(cx - 0.8), round(cx + 0.8)], samples: 60 }; break; }
    }
    if (kind !== "text" && r() < 0.6) el.label = r() < 0.7 ? pick(LABELS) : { text: pick(LABELS), priority: Math.floor(r() * 3) };
    elements.push(el);
  }
  if (elements.length === 0) elements.push({ id: "only", type: "point", at: { x: 2, y: 1.5 } });
  const m: ComposeModel = { canvas, elements };
  if (usesForce) m.scales = { force: { per: "20 N" } };
  if (r() < 0.5) m.title = `Fuzz case ${k}`;
  // Captions must fit: the scale statement is appended to the caption.
  if (r() < 0.5) m.caption = canvas.width >= 420 ? "Random composition" : "Random";
  return m;
}

// --- independent oracle over the SVG text -------------------------------------------

type Rect = { x0: number; y0: number; x1: number; y1: number };
const attrs = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1]!, m[2]!]));
function segRectDist(a: { x: number; y: number }, b: { x: number; y: number }, r: Rect): number {
  // Sample the segment densely; exact enough for a sub-pixel oracle.
  let d = Infinity;
  for (let i = 0; i <= 200; i++) {
    const p = { x: a.x + (b.x - a.x) * i / 200, y: a.y + (b.y - a.y) * i / 200 };
    const dx = Math.max(r.x0 - p.x, 0, p.x - r.x1), dy = Math.max(r.y0 - p.y, 0, p.y - r.y1);
    d = Math.min(d, Math.hypot(dx, dy));
  }
  return d;
}

export function oracle(svg: string, width: number, height: number): string[] {
  const problems: string[] = [];
  const backdrops: Rect[] = [...svg.matchAll(/<rect ([^>]*fill="#ffffff" stroke="none"[^>]*)\/>/g)].map(m => { const a = attrs(m[1]!); return { x0: +a.x!, y0: +a.y!, x1: +a.x! + +a.width!, y1: +a.y! + +a.height! }; });
  for (const b of backdrops) if (b.x0 < 0 || b.y0 < 0 || b.x1 > width || b.y1 > height) problems.push(`label backdrop outside canvas ${JSON.stringify(b)}`);
  for (let i = 0; i < backdrops.length; i++) for (let j = i + 1; j < backdrops.length; j++) {
    const a = backdrops[i]!, b = backdrops[j]!;
    if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) problems.push(`label backdrops overlap ${JSON.stringify([a, b])}`);
  }
  const lines = [...svg.matchAll(/<line ([^>]*)\/>/g)].map(m => attrs(m[1]!)).filter(a => !(a.stroke === "#777" && a["stroke-width"] === "0.8"));
  for (const l of lines) for (const b of backdrops) {
    const d = segRectDist({ x: +l.x1!, y: +l.y1! }, { x: +l.x2!, y: +l.y2! }, b);
    if (d < +l["stroke-width"]! / 2) problems.push(`line crosses a label backdrop (${d.toFixed(2)} px)`);
  }
  return problems;
}

test(`toolkit fuzz: ${FUZZ_CASES} seeded valid compositions have 0 collisions, 0 out-of-bounds, 0 non-finite and conform to the style contract`, () => {
  const totals = { cases: 0, elements: 0, labels: 0, leaders: 0, checks: 0, contacts: 0, pairsTested: 0, collisions: 0, outOfBounds: 0, nonFinite: 0, oracleProblems: 0, styleViolations: 0 };
  const failures: string[] = [];
  for (let k = 0; k < FUZZ_CASES; k++) {
    const m = generate(FUZZ_SEED, k);
    const r = compose(m);
    totals.cases++;
    if (!r.ok) { failures.push(`case ${k}: ${r.errors.map(e => `${e.code} ${e.message}`).join("; ")}`); continue; }
    const g = r.report.gate!;
    totals.elements += r.report.elements.length; totals.labels += r.report.labels.length; totals.leaders += r.report.labels.filter(l => l.leader).length;
    totals.checks += r.report.checks.length; totals.contacts += r.report.contacts.length; totals.pairsTested += g.pairsTested;
    totals.collisions += g.collisions; totals.outOfBounds += g.outOfBounds; totals.nonFinite += g.nonFinite;
    if (/NaN|Infinity/.test(r.svg)) totals.nonFinite++;
    const style = checkToolkitStyle(r.svg, { title: m.title, caption: r.report.caption });
    totals.styleViolations += style.length;
    const problems = oracle(r.svg, m.canvas.width, m.canvas.height);
    totals.oracleProblems += problems.length;
    if (style.length || problems.length) failures.push(`case ${k}: ${[...style.map(v => v.detail), ...problems].join("; ")}`);
    if (k % 10 === 0) assert.equal(compose(structuredClone(m)).ok && (compose(structuredClone(m)) as { svg: string }).svg, r.svg, `case ${k} is not deterministic`);
  }
  console.log(`FUZZ_TOTALS ${JSON.stringify(totals)}`);
  assert.deepEqual(failures, []);
  assert.equal(totals.collisions + totals.outOfBounds + totals.nonFinite + totals.styleViolations + totals.oracleProblems, 0);
  assert.ok(totals.cases >= 300);
});

test(`toolkit fuzz: ${FUZZ_CASES} seeded negative cases (one duplicated element, no mayTouch) are all rejected with E_COLLISION`, () => {
  let rejected = 0;
  const missed: string[] = [];
  for (let k = 0; k < FUZZ_CASES; k++) {
    const m = generate(FUZZ_SEED, k);
    const src = m.elements[k % m.elements.length]!;
    const dup = structuredClone(src);
    dup.id = `${src.id}_dup`;
    delete dup.label;
    // Shift by about half a pixel, in the value's own units so the sum is valid.
    const by = (v: NumLike, d: number): NumLike => typeof v === "number" ? v + d : /m$/.test(v) ? `${v} + ${d * 100} cm` : `${v} + ${d}`;
    const shift = (p: unknown): unknown => p && typeof p === "object" && "x" in (p as object) ? { x: by((p as { x: NumLike }).x, 0.01), y: by((p as { y: NumLike }).y, 0.008) } : p;
    if (dup.at) dup.at = shift(dup.at) as ElementSpec["at"];
    for (const key of ["from", "to"]) if (dup[key]) dup[key] = shift(dup[key]);
    if (Array.isArray(dup.points)) dup.points = dup.points.map(shift);
    m.elements.push(dup);
    const r = compose(m);
    if (!r.ok && r.errors.some(e => e.code === "E_COLLISION" && e.elements.includes(dup.id))) rejected++;
    else missed.push(`case ${k} (${src.type}): ${r.ok ? "accepted" : r.errors.map(e => e.code).join(",")}`);
  }
  console.log(`FUZZ_NEGATIVE ${JSON.stringify({ cases: FUZZ_CASES, rejected })}`);
  assert.deepEqual(missed, []);
});
