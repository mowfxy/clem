import { test } from "node:test";
import assert from "node:assert/strict";
import { printVisualSvg, visualBlocks, visualCaption } from "../core/visual-print.ts";
import { palette } from "../core/visual-spec.ts";
import { figureRecipes } from "../core/figure-recipes.ts";
import { documentBlocks } from "../core/document-blocks.ts";

const visuals = {
  plot: { kind: "plot", title: "Parabola", params: [{ key: "a", label: "a", min: 0, max: 2, value: 1 }], x: { min: -2, max: 2 }, y: { min: -1, max: 4 }, layers: [{ type: "function", expr: "a*x^2", label: "y = ax²" }] },
  chart: { kind: "chart", title: "Sales", chart: { type: "bar", labels: ["Q1", "Q2"], series: [{ name: "2026", values: [3, 5] }] } },
  diagram: { kind: "diagram", title: "Flow", nodes: [{ id: "a", label: "Start" }, { id: "b", label: "End" }], edges: [{ from: "a", to: "b" }], steps: [{ title: "First", focus: ["a"] }] },
  figure: { kind: "figure", title: "Apparatus", caption: "A textbook figure", ...figureRecipes[0].figure },
  "3d": { kind: "3d", title: "Saddle", x: { min: -2, max: 2 }, y: { min: -2, max: 2 }, z: { min: -4, max: 4 }, objects: [{ type: "surface", expr: "x^2 - y^2" }] },
};

test("every kind of chat visual prints on white paper in ink, never in the app's dark palette", () => {
  for (const [kind, spec] of Object.entries(visuals)) {
    const svg = printVisualSvg(spec);
    assert.match(svg, /^<svg[\s\S]*<\/svg>$/, kind);
    assert.match(svg, /fill="#ffffff"/i, kind);
    for (const dark of [palette.bg, palette.ink, palette.panel]) assert.ok(!svg.toLowerCase().includes(dark), `${kind} still uses ${dark}`);
  }
  // A chart prints fully grown, not as the first frame of its animation (bars of zero height).
  const bars = printVisualSvg(visuals.chart).match(/<path d="[^"]+Z" fill="#1f4e79"/g) || [];
  assert.equal(bars.length, 2);
  assert.match(printVisualSvg(visuals.plot), /y = ax²/);
  assert.throws(() => printVisualSvg({ kind: "chart", title: "x" }), /needs labels and series/);
});

test("visual blocks are found in Markdown with their captions; unreadable ones are skipped", () => {
  const md = "Intro\n```visual\n" + JSON.stringify(visuals.chart) + "\n```\nMiddle\n```visual\n{not json\n```\nEnd";
  const found = visualBlocks(md);
  assert.equal(found.length, 1);
  assert.equal(found[0].spec.title, "Sales");
  assert.equal(md.slice(found[0].start, found[0].end).startsWith("```visual"), true);
  assert.equal(visualCaption({ title: "T", caption: "C" }), "C");
  assert.equal(visualCaption({ title: "T" }), "T");
  // Word and PowerPoint exports see a visual block as a figure, never as JSON code.
  const blocks = documentBlocks(md);
  assert.deepEqual(blocks.map((b) => b.kind), ["paragraph", "visual", "paragraph", "paragraph"]);
});
