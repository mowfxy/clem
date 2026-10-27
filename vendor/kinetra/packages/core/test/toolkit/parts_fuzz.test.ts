/**
 * Seeded fuzz over the part library: each case lays out a random grid of
 * cells, each holding a random part sample (with its own seeded variation and
 * helpers), random labels, zoom, title and caption. Every case must compose
 * with 0 collisions, 0 out-of-bounds and 0 non-finite values, conform to the
 * style contract, pass the SVG oracle, and have every painted pixel sample
 * covered by the painting element's collision shapes. A negative arm drops a
 * copy of one cell's main element on top of it and requires E_COLLISION.
 * (The basic-shape fuzz in fuzz.test.ts is unchanged.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkToolkitStyle, compose, getToolkitPart, TOOLKIT_PART_CATALOG, TOOLKIT_PART_SAMPLES } from "../../src/toolkit/index.js";
import type { ComposeModel, ElementSpec } from "../../src/toolkit/index.js";
import { rng, svgOracle, uncovered } from "./parts_helpers.js";

export const PARTS_FUZZ_SEED = 20261028;
export const PARTS_FUZZ_CASES = 300;
const LABELS = ["A", "B", "F", "m", "v₀", "θ", "T_1", "x^2", "N", "k", "\\omega", "R_2", "load", "q = 2 C"];
const SHORT = ["A", "B", "F", "m", "θ", "N", "k", "\\omega"];
const TYPES = TOOLKIT_PART_CATALOG.map(p => p.type);

export function generateParts(seed: number, k: number): { model: ComposeModel; mains: string[] } {
  const r = rng(seed * 7919 + k);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const cols = 3 + Math.floor(r() * 3), rows = 2 + Math.floor(r() * 2), CW = 4, CH = 3.4;
  const ppu = 50 + Math.round(r() * 20);
  const elements: ElementSpec[] = [];
  const mains: string[] = [];
  // Cycle through the catalogue so every part appears often, offset per case.
  let cursor = Math.floor(r() * TYPES.length);
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    if (r() < 0.08) continue;
    const type = r() < 0.5 ? TYPES[cursor++ % TYPES.length]! : pick(TYPES);
    const id = `c${i}_${j}`;
    const els = TOOLKIT_PART_SAMPLES.get(type)!(id, { x: i * CW + CW / 2, y: j * CH + CH / 2 }, r);
    const main = els[0]!;
    // Parts drawn inside a plot frame get short labels: long text cannot fit between the
    // grid lines of a small cell, and the engine rightly reports that as E_LABEL_UNPLACEABLE.
    const texts = main.axes !== undefined ? SHORT : LABELS;
    if (main.label === undefined && getToolkitPart(main.type)!.label && r() < 0.4) main.label = r() < 0.7 ? pick(texts) : { text: pick(texts), size: pick([11, 12] as const), priority: Math.floor(r() * 3) };
    elements.push(...els);
    mains.push(id);
  }
  if (!elements.length) { elements.push(...TOOLKIT_PART_SAMPLES.get("pulley")!("only", { x: 2, y: 1.7 }, r)); mains.push("only"); }
  const W = cols * CW, H = rows * CH;
  const model: ComposeModel = { canvas: { width: Math.round(W * ppu), height: Math.round((H + 0.4) * ppu), world: { xMin: 0, xMax: W, yMin: -0.2, yMax: H + 0.2 } }, elements };
  if (r() < 0.5) model.title = `Parts fuzz ${k}`;
  if (r() < 0.4) model.caption = "Random part composition";
  return { model, mains };
}

test(`parts fuzz: ${PARTS_FUZZ_CASES} seeded compositions of random parts are clean, covered, on-contract and deterministic`, () => {
  const totals = { cases: 0, elements: 0, partTypes: 0, labels: 0, leaders: 0, contacts: 0, pairsTested: 0, collisions: 0, outOfBounds: 0, nonFinite: 0, oracleProblems: 0, styleViolations: 0, paintSamplesUncovered: 0 };
  const seen = new Set<string>();
  const failures: string[] = [];
  for (let k = 0; k < PARTS_FUZZ_CASES; k++) {
    const { model: m } = generateParts(PARTS_FUZZ_SEED, k);
    const r = compose(m);
    totals.cases++;
    if (!r.ok) { failures.push(`case ${k}: ${r.errors.map(e => `${e.code} [${e.elements.join(",")}] ${e.message}`).join("; ")}`); continue; }
    for (const e of r.report.elements) seen.add(e.type);
    const g = r.report.gate!;
    totals.elements += r.report.elements.length; totals.labels += r.report.labels.length; totals.leaders += r.report.labels.filter(l => l.leader).length;
    totals.contacts += r.report.contacts.length; totals.pairsTested += g.pairsTested;
    totals.collisions += g.collisions; totals.outOfBounds += g.outOfBounds; totals.nonFinite += g.nonFinite;
    const style = checkToolkitStyle(r.svg, { title: m.title, caption: r.report.caption });
    const problems = svgOracle(r.svg, m.canvas.width, m.canvas.height);
    const missed = uncovered(m).filter(u => u.missed > 0);
    totals.styleViolations += style.length; totals.oracleProblems += problems.length; totals.paintSamplesUncovered += missed.reduce((s, u) => s + u.missed, 0);
    if (style.length || problems.length || missed.length) failures.push(`case ${k}: ${[...style.map(v => v.detail), ...problems, ...missed.map(u => `${u.id} (${u.type}) paints ${u.missed} uncovered samples`)].join("; ")}`);
    if (k % 10 === 0) { const again = compose(structuredClone(generateParts(PARTS_FUZZ_SEED, k).model)); assert.ok(again.ok && again.svg === r.svg, `case ${k} is not deterministic`); }
  }
  totals.partTypes = [...seen].filter(t => TOOLKIT_PART_CATALOG.some(p => p.type === t)).length;
  console.log(`PARTS_FUZZ_TOTALS ${JSON.stringify(totals)}`);
  assert.deepEqual(failures, []);
  assert.equal(totals.collisions + totals.outOfBounds + totals.nonFinite + totals.styleViolations + totals.oracleProblems + totals.paintSamplesUncovered, 0);
  assert.equal(totals.partTypes, TOOLKIT_PART_CATALOG.length, "every part type appears in the fuzz");
});

test(`parts fuzz: ${PARTS_FUZZ_CASES} seeded negative cases (a copy of one part on top of it, no mayTouch) are all rejected with E_COLLISION`, () => {
  let rejected = 0;
  const missed: string[] = [];
  for (let k = 0; k < PARTS_FUZZ_CASES; k++) {
    const { model: m, mains } = generateParts(PARTS_FUZZ_SEED, k);
    const id = mains[k % mains.length]!;
    const dup = structuredClone(m.elements.find(e => e.id === id)!);
    dup.id = `${id}_dup`; delete dup.label; delete dup.mayTouch;
    m.elements.push(dup);
    const r = compose(m);
    if (!r.ok && r.errors.some(e => e.code === "E_COLLISION" && e.elements.includes(dup.id))) rejected++;
    else missed.push(`case ${k} (${dup.type}): ${r.ok ? "accepted" : r.errors.map(e => e.code).join(",")}`);
  }
  console.log(`PARTS_FUZZ_NEGATIVE ${JSON.stringify({ cases: PARTS_FUZZ_CASES, rejected })}`);
  assert.deepEqual(missed, []);
});
