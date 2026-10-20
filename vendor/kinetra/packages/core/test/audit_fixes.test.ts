// Regression tests for the Clem audit fixes (see CLEM_PATCHES.md).

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseExpr } from "../src/math/expression.js";
import { evaluate } from "../src/math/eval.js";
import { derivative, simplify, exprToPoly, integratePoly } from "../src/math/symbolic.js";
import { findPolynomialRoots } from "../src/math/algebra.js";
import { buildKMap } from "../src/dld/kmap.js";
import { parseBoolExpr, collectVariables } from "../src/dld/expression.js";
import { expressionToMask } from "../src/dld/truth_table.js";
import { context } from "../src/dld/boolean.js";
import { solveNetlistTransient } from "../src/circuit/spice.js";
import { renderPlotSvg } from "../src/graph/render_svg.js";

const ev = (s: string, vars: Record<string, number> = {}) => evaluate(parseExpr(s), { vars });
const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const d = (s: string, x: number) => evaluate(derivative("x", parseExpr(s)), { vars: { x } });
const poly = (s: string) => Object.fromEntries(exprToPoly(parseExpr(s)));

test("parser: bare e is Euler's number, exponents need digits", () => {
  close(ev("2e"), 2 * Math.E);
  close(ev("2exp(1)"), 2 * Math.E);
  close(ev("2e^x", { x: 1 }), 2 * Math.E);
  close(ev("1.5e3"), 1500);
  close(ev("1e-3"), 0.001);
});

test("parser: d/dx(...) differentiates by x; d/t is a division", () => {
  close(ev("d/dx(x^2)", { x: 3 }), 6);
  close(ev("d/dt(t^3)", { t: 2 }), 12);
  close(ev("d/2", { d: 4 }), 2);
  close(ev("d/t", { d: 4, t: 2 }), 2);
  close(ev("d/dx(d/dx(x^3))", { x: 1 }), 6);
});

test("parser: implicit multiplication", () => {
  close(ev("(x+1)x", { x: 2 }), 6);
  close(ev("x y", { x: 2, y: 3 }), 6);
  close(ev("x(x+1)", { x: 2 }), 6);
  close(ev("πr^2", { r: 2 }), 4 * Math.PI);
  close(ev("2πf", { f: 1 }), 2 * Math.PI);
  close(ev("sin(x)cos(x)", { x: 1 }), Math.sin(1) * Math.cos(1));
  assert.throws(() => ev("foo(2)"), /Unknown function/);
});

test("parser: precedence and sums", () => {
  close(ev("2^3^2"), 512);
  close(ev("-x^2", { x: 3 }), -9);
  close(ev("2^-1"), 0.5);
  close(ev("8-4-2"), 2);
  close(ev("8/4/2"), 1);
  close(ev("Σ k=1 to 4 (k)"), 10);
  close(ev("Σ k=1...n (k^2)", { n: 3 }), 14);
  close(ev("∏ k=1...4 (k)"), 24);
});

test("eval: log with one argument is log10; variables are own properties only", () => {
  close(ev("log(100)"), 2);
  close(ev("log(8, 2)"), 3);
  assert.throws(() => ev("constructor"), /Unknown variable/);
});

test("derivative: power, abs, log and other functions", () => {
  close(d("x^2", -1), -2);
  close(d("x^2", 0), 0);
  close(d("2^x", 0), Math.LN2);
  close(d("x^x", 2), 4 * (Math.log(2) + 1));
  close(d("abs(x)", 2), 1);
  close(d("abs(x)", -2), -1);
  close(d("log10(x)", 1), 1 / Math.LN10);
  close(d("log2(x)", 1), 1 / Math.LN2);
  close(d("log(x, 2)", 1), 1 / Math.LN2);
  close(d("cbrt(x)", 8), 1 / 12);
  close(d("pow(x, 2)", 3), 6);
  close(d("floor(x)", 1.5), 0);
  close(d("atan2(x, 1)", 0), 1);
  assert.throws(() => derivative("x", parseExpr("max(x, 1)")), /No derivative rule/);
});

test("polynomials: products keep every factor and never hang", () => {
  assert.deepEqual(poly("x*x"), { "x*x": 1 });
  assert.deepEqual(poly("x^2"), { "x*x": 1 });
  assert.deepEqual(poly("x*y"), { "x*y": 1 });
  assert.deepEqual(poly("(x+1)*(x+2)"), { "x*x": 1, x: 3, "1": 2 });
  assert.throws(() => exprToPoly(parseExpr("x^-1")), /non-negative/);
  close(evaluate(simplify(parseExpr("x*y + 2*x*y")), { vars: { x: 2, y: 3 } }), 18);
  close(evaluate(simplify(parseExpr("sin(x) + 1")), { vars: { x: 0 } }), 1);
  close(evaluate(simplify(parseExpr("x*sin(x)")), { vars: { x: 1 } }), Math.sin(1));
  assert.deepEqual(Object.fromEntries(integratePoly(exprToPoly(parseExpr("3*x^2 + y")), "x")), { "x*x*x": 1, "x*y": 1 });
});

test("findPolynomialRoots: real and complex roots of any degree", () => {
  assert.deepEqual(findPolynomialRoots(exprToPoly(parseExpr("x^2 - 4"))).real.map((r) => Math.round(r * 1e9) / 1e9), [-2, 2]);
  const cubic = findPolynomialRoots(exprToPoly(parseExpr("x^3 - 6*x^2 + 11*x - 6"))).real;
  [1, 2, 3].forEach((r, i) => close(cubic[i], r, 1e-9));
  const c = findPolynomialRoots(exprToPoly(parseExpr("x^2 + 1")));
  assert.equal(c.real.length, 0);
  assert.deepEqual(c.complex.map((z) => Math.round(Math.abs(z.im) * 1e9) / 1e9), [1, 1]);
  assert.deepEqual(findPolynomialRoots(exprToPoly(parseExpr("2*x - 1"))).real, [0.5]);
});

const vars = ["A", "B", "C", "D"];
const maskOf = (e: any, v = vars) => expressionToMask(e, context(v));
const bits = (m: bigint, n = 16) => [...Array(n).keys()].filter((i) => ((m >> BigInt(i)) & 1n) === 1n);

test("K-map: cells sit where their minterm is (first variable is bit 0, as in truth tables)", () => {
  const k = buildKMap({ variables: ["A", "B", "C"], minterms: [1, 3, 5, 7] });
  assert.equal(k.simplifiedText, "A");
  // Every 1 is in the row where A = 1.
  assert.deepEqual([...new Set(k.cells.filter((c) => c.value === 1).map((c) => c.row))], [1]);
  for (const c of k.cells) {
    const a = c.row, b = [0, 0, 1, 1][c.col], cc = [0, 1, 1, 0][c.col];
    assert.equal(c.index, a | (b << 1) | (cc << 2));
  }
});

test("K-map: prime implicants only, and a minimal cover", () => {
  // A D' covers 1,3,5,7; the old cover printed the non-prime A!B!D.
  const k = buildKMap({ variables: vars, minterms: [1, 3, 7, 11, 15], dontCares: [0, 2, 5] });
  assert.equal((k.simplified as any).args.length, 2);
  for (const g of k.groups) assert.equal(g.positives.length + g.negatives.length, 2);
  // Greedy picked 3 terms where 2 do.
  const k2 = buildKMap({ variables: vars, minterms: [0, 8, 10, 11, 12, 14, 15], dontCares: [4] });
  assert.equal((k2.simplified as any).args.length, 2);
  const m = maskOf(k2.simplified);
  for (const i of [0, 8, 10, 11, 12, 14, 15]) assert.ok(bits(m).includes(i));
  for (const i of bits(m)) assert.ok([0, 4, 8, 10, 11, 12, 14, 15].includes(i));
});

test("K-map POS: don't-cares are free, text is a product of sums", () => {
  const k = buildKMap({ variables: vars, minterms: [1, 3, 7, 11, 15], dontCares: [0, 2, 5], form: "pos" });
  assert.equal(k.simplifiedText, "A(B + !D)");
  const m = maskOf(k.simplified);
  for (const i of [1, 3, 7, 11, 15]) assert.ok(bits(m).includes(i));
  for (const i of [4, 6, 8, 9, 10, 12, 13, 14]) assert.ok(!bits(m).includes(i));
  // Only don't-cares besides the ones: the product is 1.
  const one = buildKMap({ variables: ["A", "B"], minterms: [0, 1], dontCares: [2, 3], form: "pos" });
  assert.equal(one.simplifiedText, "1");
  assert.throws(() => buildKMap({ variables: ["A", "B", "C"], minterms: [9] }), /out of range/);
});

test("Boolean parser: spelled-out operators", () => {
  const same = (a: string, b: string) => assert.equal(maskOf(parseBoolExpr(a), ["A", "B", "C"]), maskOf(parseBoolExpr(b), ["A", "B", "C"]));
  same("A or B", "A + B");
  same("A and B or C", "AB + C");
  same("A xor B", "A ^ B");
  same("not A and B", "!A B");
  same("A AND B OR NOT A AND NOT B AND C", "AB + !A!BC");
  assert.deepEqual(collectVariables(parseBoolExpr("A or B")), ["A", "B"]);
});

test("transient: dt must be positive (dt = 0 looped forever)", () => {
  const rc = { elements: [{ kind: "voltage-source", from: "0", to: "a", value: 5 }, { kind: "resistor", from: "a", to: "b", value: 1000 }, { kind: "capacitor", from: "b", to: "0", value: 1e-6 }] };
  assert.throws(() => solveNetlistTransient(rc, { startTime: 0, endTime: 0.001, dt: 0 }), /dt > 0/);
});

test("plot: degenerate ranges render finite SVG", () => {
  const base = { id: "p", title: "t", xAxis: {}, yAxis: {} } as any;
  const one = renderPlotSvg({ ...base, type: "scatter", xRange: [1, 1], data: [{ x: 1, y: 2 }] });
  assert.ok(!/NaN|Infinity/.test(one));
  // A y-range of one double spacing at 1e20 used to loop in makeTicks until the array overflowed.
  const ulp = renderPlotSvg({ ...base, type: "scatter", xRange: [0, 2], data: [{ x: 0, y: 1e20 }, { x: 1, y: 1e20 + 16384 }] });
  assert.ok(ulp.startsWith("<?xml"));
});
