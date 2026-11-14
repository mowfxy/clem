/**
 * Regression tests for the visual audit: label backdrops that no longer show
 * as white boxes on filled shapes, script markup in captions, left-aligned
 * legend text, a support anchor clear of the hatching, and extra label
 * clearance beside a wavy heat arrow, arrow labels beside a tip near the
 * canvas edge, the logicGate sample spacing and script markup in examples.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { compose, TOOLKIT_PART_SAMPLES } from "../../src/toolkit/index.js";
import type { ComposeModel, ComposeResult } from "../../src/toolkit/index.js";
import { tidyLabelBackdrops } from "../../src/toolkit/backdrops.js";
import { measureLabelWidth } from "../../src/toolkit/text_metrics.js";

type Ok = Extract<ComposeResult, { ok: true }>;
const run = (m: ComposeModel): Ok => { const r = compose(m); assert.ok(r.ok, JSON.stringify(!r.ok && r.errors)); return r as Ok; };
const canvas = { width: 400, height: 300, world: { xMin: 0, xMax: 8, yMin: 0, yMax: 6 } };
const attrs = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1]!, m[2]!]));
/** The backdrop rect drawn immediately before the <text> holding `content`. */
function backdropOf(svg: string, content: string) {
  const lines = svg.split("\n"), k = lines.findIndex(l => l.trim() === content);
  assert.ok(k >= 2, `text "${content}" not found`);
  const rect = attrs(lines[k - 2]!), text = attrs(lines[k - 1]!);
  return { fill: rect.fill!, x: Number(rect.x), w: Number(rect.width), textX: Number(text.x), anchor: text["text-anchor"]!, size: Number(text["font-size"]) };
}

test("backdrop: text inside a filled part takes the part's fill and hugs the glyphs", () => {
  const r = run({ version: 1, canvas, elements: [{ id: "box", type: "roundedBox", at: { x: 4, y: 3 }, w: 4, h: 2, fill: "mechanismFill", text: "Instruction memory" }] } as ComposeModel);
  const b = backdropOf(r.svg, "Instruction memory");
  assert.notEqual(b.fill, "#ffffff", "no white box on the filled part");
  assert.match(r.svg, new RegExp(`<rect [^>]*fill="${b.fill}" stroke="#`), "the backdrop uses the box's own fill");
  const glyphs = measureLabelWidth("Instruction memory", b.size);
  assert.ok(b.w <= glyphs + 2 + 1e-9, `backdrop ${b.w} px is no wider than the glyphs ${glyphs} px plus 1 px each side`);
  assert.ok(Math.abs(b.x + b.w / 2 - b.textX) < 1e-6, "backdrop is centred on the text");
});

test("backdrop: text on white paper keeps the recognisable white backdrop", () => {
  const r = run({ version: 1, canvas, elements: [{ id: "box", type: "roundedBox", at: { x: 4, y: 3 }, w: 4, h: 2, text: "Plain" }] } as ComposeModel);
  assert.equal(backdropOf(r.svg, "Plain").fill, "#ffffff");
});

test("backdrop: a rect that straddles a filled shape's edge stays white", () => {
  const svg = ["<g>", `<rect x="0" y="0" width="100" height="100" fill="#d6e1e6" stroke="#222" stroke-width="1" rx="0"/>`, `<rect x="80" y="40" width="60" height="14" fill="#ffffff" stroke="none"/>`, `<text x="81" y="50" fill="#222" font-size="12" text-anchor="start" font-family="Arial, Helvetica, sans-serif" font-weight="normal">`, "straddles", "</text>", "</g>"].join("\n");
  assert.match(tidyLabelBackdrops(svg), /fill="#ffffff" stroke="none"/);
  const inside = svg.replace(`x="80" y="40"`, `x="10" y="40"`).replace(`<text x="81"`, `<text x="11"`);
  assert.match(tidyLabelBackdrops(inside), /<rect x="10" y="40" width="[\d.]+" height="14" fill="#d6e1e6" stroke="none"\/>/);
});

test("backdrop: the pass is idempotent and leaves label-free SVG untouched", () => {
  const r = run({ version: 1, canvas, elements: [{ id: "box", type: "roundedBox", at: { x: 4, y: 3 }, w: 4, h: 2, fill: "bodyFill", text: "Twice" }] } as ComposeModel);
  assert.equal(tidyLabelBackdrops(r.svg), r.svg);
  const bare = `<g>\n<rect x="0" y="0" width="10" height="10" fill="#fff"/>\n</g>`;
  assert.equal(tidyLabelBackdrops(bare), bare);
});

test("caption: script markup renders as real sub- and superscripts", () => {
  const r = run({ version: 1, canvas, caption: "T_H = 500 K, a = 2 m/s^2, v_{out}", elements: [{ id: "c", type: "circle", at: { x: 4, y: 3 }, r: 1 }] } as ComposeModel);
  assert.equal(r.report.caption, "TH = 500 K, a = 2 m/s2, vout");
  assert.match(r.svg, /T<tspan font-size="8" dy="3\.3">H<\/tspan><tspan dy="-3\.3"> = 500 K, a = 2 m\/s<\/tspan><tspan font-size="8" dy="-4\.4">2<\/tspan>/);
  assert.doesNotMatch(r.svg, /T_H|s\^2/);
});

test("caption: text that is not valid markup is kept as written", () => {
  const r = run({ version: 1, canvas, caption: "path C:\\temp\\file and a trailing _", elements: [{ id: "c", type: "circle", at: { x: 4, y: 3 }, r: 1 }] } as ComposeModel);
  assert.equal(r.report.caption, "path C:\\temp\\file and a trailing _");
});

test("legend: entry text shares one left edge", () => {
  const r = run({ version: 1, canvas, elements: [{ id: "lg", type: "legend", at: { x: 4, y: 3 }, entries: [{ text: "node", kind: "circle" }, { text: "antinode", kind: "dot" }, { text: "y(x, t) envelope", kind: "line" }] }] } as ComposeModel);
  const lefts = ["node", "antinode", "y(x, t) envelope"].map(t => { const b = backdropOf(r.svg, t); return b.textX - measureLabelWidth(t, b.size) / 2; });
  assert.ok(Math.max(...lefts) - Math.min(...lefts) < 1e-6, `left edges differ: ${lefts.join(", ")}`);
});

test("supports: the under anchor clears the ground hatching", () => {
  for (const type of ["pinSupport", "rollerSupport"]) {
    const m = { version: 1, canvas, scales: { force: { per: "10 N" } }, elements: [
      { id: "s", type, at: { x: 4, y: 4 }, scale: 1.4 },
      { id: "R", type: "pointLoad", tip: "s.under", angle: 90, magnitude: "10 N" },
    ] } as ComposeModel;
    const r = run(m);
    // The hatch strokes are the support's #777-free 1 px lines below the ground line; the arrow tip must lie below all of them.
    const tipY = Math.min(...[...r.svg.matchAll(/<line x1="[^"]*" y1="([^"]*)" x2="[^"]*" y2="([^"]*)"[^>]*marker-end/g)].flatMap(x => [Number(x[1]), Number(x[2])]));
    const ground = [...r.svg.matchAll(/<line x1="[^"]*" y1="([^"]*)" x2="[^"]*" y2="([^"]*)" stroke="#222" stroke-width="1\.4"/g)].map(x => Number(x[1]));
    assert.equal(ground.length, 1, "one ground line");
    assert.ok(tipY >= ground[0]! + 9, `${type}: arrow tip (y=${tipY}) is at least 9 px below the ground line (y=${ground[0]})`);
  }
});

test("heatFlow: its label keeps clear of the wavy shaft", () => {
  const r = run({ version: 1, canvas, elements: [{ id: "q", type: "heatFlow", from: { x: 4, y: 5 }, to: { x: 4, y: 1 }, label: "Q_H = 1000 J" }] } as ComposeModel);
  const label = r.report.labels.find(l => l.owner === "q")!;
  const shaftX = 4 * (400 / 8);
  const gap = Math.min(Math.abs(label.box.x0 - shaftX), Math.abs(label.box.x1 - shaftX));
  assert.ok(gap >= 8, `label is ${gap.toFixed(1)} px from the shaft axis (3 px wave + 5 px clear)`);
});

test("arrow: a label beside a tip near the canvas edge needs no leader", () => {
  // Rightward arrow ending 20 px from the right edge: the ahead-of-tip candidates are off the
  // canvas, so the label must take a side candidate clear of its own arrowhead.
  const r = run({ version: 1, canvas, elements: [{ id: "a", type: "arrow", from: { x: 4, y: 3 }, to: { x: 7.6, y: 3 }, label: "I_3 = 3.5 A" }] } as ComposeModel);
  const label = r.report.labels.find(l => l.owner === "a")!;
  assert.notEqual(label.position, "leader", "placed beside the tip, not on a leader line");
  assert.equal(label.leader, undefined);
  const tip = { x: 7.6 * 50, y: 300 - 3 * 50 };
  assert.ok(label.box.x1 <= tip.x, "label stays behind the tip");
  assert.ok(label.box.y1 <= tip.y - 3.5 - 2 || label.box.y0 >= tip.y + 3.5 + 2, "label clears the 3.5 px arrowhead by the 2 px text clearance");
});

test("logicGate sample: the IEC and ANSI gates sit apart inside the 4 x 3.4 cell", () => {
  const rng = (seed: number) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  for (let seed = 0; seed < 24; seed++) {
    const els = TOOLKIT_PART_SAMPLES.get("logicGate")!("g", { x: 2, y: 1.9 }, rng(seed)) as Record<string, unknown>[];
    assert.equal(els.length, 2);
    // World = the cell, so E_OUT_OF_BOUNDS proves both gates stay inside it.
    const r = run({ version: 1, canvas: { width: 200, height: 170, world: { xMin: 0, xMax: 4, yMin: 0, yMax: 3.4 } }, elements: [
      ...els,
      { id: "o", type: "point", at: "g.out", mayTouch: ["g"] },
      { id: "i", type: "point", at: "g_b.in0", mayTouch: ["g_b"] },
    ] } as ComposeModel);
    const o = r.report.elements.find(e => e.id === "o")!.origin, i = r.report.elements.find(e => e.id === "i")!.origin;
    assert.ok(i.x - o.x >= 0.3, `seed ${seed}: ${(i.x - o.x).toFixed(2)} world units between the IEC output and the ANSI inputs`);
    assert.ok(Math.abs(o.y - i.y) < 0.6, `seed ${seed}: the two gates share one row`);
  }
});

test("examples: labels and part text use script markup, titles stay Unicode", () => {
  const scripts = /[⁰-ₜ²³¹]/;
  const root = new URL("../../../../examples/toolkit/", import.meta.url);
  const walk = (dir: URL): URL[] => readdirSync(dir).flatMap(n => { const u = new URL(n, dir); return statSync(u).isDirectory() ? walk(new URL(n + "/", dir)) : n.endsWith(".json") ? [u] : []; });
  const found: string[] = [];
  const visit = (v: unknown, path: string) => {
    if (typeof v === "string") { if (scripts.test(v) && !path.endsWith(".title")) found.push(`${path}: ${v}`); }
    else if (Array.isArray(v)) v.forEach((x, k) => visit(x, `${path}[${k}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) visit(x, `${path}.${k}`);
  };
  for (const f of walk(root)) visit(JSON.parse(readFileSync(f, "utf8")), f.pathname.split("/examples/toolkit/")[1]!);
  assert.deepEqual(found, [], "Unicode sub/superscripts outside titles; write n_1, x^2, v_{out} instead");
});
