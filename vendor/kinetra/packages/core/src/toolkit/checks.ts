/**
 * Declared checks: invariants verified before rendering. A failing check
 * blocks the render and reports expected vs actual. Arrows that encode
 * quantities also get an automatic "length proportional to value" check per
 * quantity type, measured on the final view geometry.
 */
import { fail, ToolkitFailure } from "./errors.js";
import type { ToolkitIssue } from "./errors.js";
import { DIMLESS, LENGTH, dimLabel, evalLength, evalQuantity, mapScope, qdimEqual } from "./expr.js";
import type { Scope, TkQuantity } from "./expr.js";
import { pointPolylineDist } from "./geometry.js";
import type { PartContext } from "./parts.js";
import { resolvePoint } from "./resolver.js";
import type { Resolved } from "./resolver.js";
import type { CheckSpec, NumLike } from "./types.js";

export interface CheckResult {
  id: string;
  type: string;
  pass: boolean;
  automatic?: boolean;
  expected: unknown;
  actual: unknown;
  residual: number;
  tolerance: number;
  unit: string;
  elements: string[];
}

/** Scope exposing `<id>.<ref>` values of every resolved element. */
export function elementScope(res: Resolved, ctx: PartContext, parent: Scope): Scope {
  const values = new Map<string, TkQuantity>();
  for (const id of res.order) {
    const inst = res.instances.get(id)!, def = res.defs.get(id)!;
    // Anchor coordinates (Agent 3): <id>.<anchor>.x / .y for every anchor without an argument.
    for (const name of def.anchorNames) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || def.anchorArgs?.[name]) continue;
      let p: { x: number; y: number } | undefined;
      try { p = def.anchor(inst, name, undefined, ctx); } catch { p = undefined; }
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      values.set(`${id}.${name}.x`, { value: p.x * ctx.worldUnitSI, dim: LENGTH });
      values.set(`${id}.${name}.y`, { value: p.y * ctx.worldUnitSI, dim: LENGTH });
    }
    for (const [k, v] of Object.entries(def.refs?.(inst, ctx) ?? {})) values.set(`${id}.${k}`, v);
  }
  return mapScope(values, parent);
}

const fmt = (q: TkQuantity) => ({ value: q.value, unit: dimLabel(q.dim) });

export function runChecks(specs: CheckSpec[] | undefined, res: Resolved, ctx: PartContext, scope: Scope): { results: CheckResult[]; issues: ToolkitIssue[] } {
  const results: CheckResult[] = [];
  const issues: ToolkitIssue[] = [];
  if (specs !== undefined && !Array.isArray(specs)) fail("E_SCHEMA", [], "\"checks\" must be a list", { path: "checks" });
  for (const [k, spec] of (specs ?? []).entries()) {
    const id = spec?.id ?? `check${k}`;
    const path = `checks[${k}]`;
    try {
      const r = runOne(spec, id, path, res, ctx, scope);
      results.push(r);
      if (!r.pass) issues.push({
        code: "E_CHECK_FAILED", elements: [`check:${id}`, ...r.elements], path,
        message: `Check "${id}" (${r.type}) failed: expected ${show(r.expected)}, got ${show(r.actual)} (residual ${r.residual.toPrecision(4)} ${r.unit} > tolerance ${r.tolerance.toPrecision(3)})`,
        measured: { expected: r.expected, actual: r.actual, residual: r.residual, tolerance: r.tolerance, unit: r.unit },
        suggestion: suggestionFor(r),
      });
    } catch (e) {
      if (e instanceof ToolkitFailure) { issues.push({ ...e.issue, elements: [...new Set([`check:${id}`, ...e.issue.elements])] }); continue; }
      throw e;
    }
  }
  // Automatic: arrows of one quantity type share one scale on screen.
  const byQuantity = new Map<string, { id: string; magnitude: number; px: number }[]>();
  for (const id of res.order) {
    const inst = res.instances.get(id)!, def = res.defs.get(id)!;
    const q = def.quantity?.(inst);
    if (!q) continue;
    const tip = def.anchor(inst, "tip", undefined, ctx)!, a = ctx.view.toView(q.tail), b = ctx.view.toView(tip);
    const list = byQuantity.get(q.quantity) ?? [];
    list.push({ id, magnitude: q.value.value, px: Math.hypot(b.x - a.x, b.y - a.y) });
    byQuantity.set(q.quantity, list);
  }
  for (const [name, list] of byQuantity) {
    const scale = ctx.scales.get(name)!;
    const expected = ctx.view.scale / scale.per.value; // px per SI unit
    const worst = Math.max(...list.map(a => Math.abs(a.px / a.magnitude - expected) / expected));
    const r: CheckResult = { id: `scale:${name}`, type: "proportional", automatic: true, pass: worst <= 1e-9, expected: { pxPerUnit: expected, scale: scale.text }, actual: Object.fromEntries(list.map(a => [a.id, a.px / a.magnitude])), residual: worst, tolerance: 1e-9, unit: "relative", elements: list.map(a => a.id) };
    results.push(r);
    if (!r.pass) issues.push({ code: "E_CHECK_FAILED", elements: [`check:${r.id}`, ...r.elements], message: `Arrows for "${name}" do not share the declared scale (worst relative error ${worst.toExponential(2)})`, measured: { expected: r.expected, actual: r.actual } });
  }
  return { results, issues };
}

function show(v: unknown): string {
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

function suggestionFor(r: CheckResult): string {
  switch (r.type) {
    case "vectorSum": return `The listed vectors do not balance. Recompute the magnitudes/angles of ${r.elements.join(", ")} from the physics, or correct the expected sum.`;
    case "momentSum": return `Moments about the point do not balance. Check the tail points (lever arms) and magnitudes of ${r.elements.join(", ")}.`;
    case "kcl": return "Currents into the node must equal currents out. Fix a value or a direction.";
    case "table": return "Recompute the table entries from the function, or fix the function.";
    case "onCurve": return "Move the point onto the curve, e.g. place it with the curve's anchor at(x).";
    default: return "Correct the model values so the declared relation holds, or fix the check.";
  }
}

function tolOf(spec: { tol?: NumLike }, like: TkQuantity, scope: Scope, path: string, id: string, def: number): number {
  if (spec.tol === undefined) return def;
  const t = evalQuantity(spec.tol, scope, `${path}.tol`, [`check:${id}`]);
  if (!qdimEqual(t.dim, like.dim) && !qdimEqual(t.dim, DIMLESS)) fail("E_UNIT_MISMATCH", [`check:${id}`], `Tolerance of "${id}" is ${dimLabel(t.dim)}, but the checked values are ${dimLabel(like.dim)}`, { path: `${path}.tol` });
  if (!(t.value >= 0)) fail("E_INVALID_VALUE", [`check:${id}`], `Tolerance of "${id}" must not be negative`, { path: `${path}.tol` });
  return t.value;
}

const defaultTol = (...xs: number[]) => 1e-9 * Math.max(1, ...xs.map(Math.abs));

function arrowQuantities(ids: unknown, res: Resolved, id: string, path: string) {
  if (!Array.isArray(ids) || ids.length === 0) fail("E_SCHEMA", [`check:${id}`], `${path} must list arrow ids`, { path });
  return ids.map((aid: unknown) => {
    const inst = typeof aid === "string" ? res.instances.get(aid) : undefined;
    if (!inst) fail("E_UNKNOWN_REF", [`check:${id}`], `${path} names unknown element ${JSON.stringify(aid)}`, { path });
    const q = res.defs.get(inst.id)!.quantity?.(inst);
    if (!q) fail("E_SCHEMA", [`check:${id}`, inst.id], `"${inst.id}" is not an arrow with a "magnitude" quantity`, { path, suggestion: "Give the arrow {\"angle\": ..., \"magnitude\": \"<value with unit>\"} so it encodes a quantity." });
    return { id: inst.id, q };
  });
}

function runOne(spec: CheckSpec, id: string, path: string, res: Resolved, ctx: PartContext, scope: Scope): CheckResult {
  const owner = [`check:${id}`];
  const q = (v: NumLike, p: string) => evalQuantity(v, scope, p, owner);
  if (!spec || typeof spec !== "object" || typeof spec.type !== "string") fail("E_SCHEMA", owner, `${path} needs a "type"`, { path });
  switch (spec.type) {
    case "equal": case "less": case "lessEqual": case "greater": case "greaterEqual": {
      const l = q(spec.left, `${path}.left`), r = q(spec.right, `${path}.right`);
      if (!qdimEqual(l.dim, r.dim)) fail("E_UNIT_MISMATCH", owner, `Check "${id}" compares ${dimLabel(l.dim)} with ${dimLabel(r.dim)}`, { path, measured: { left: fmt(l), right: fmt(r) } });
      if (spec.type === "equal") {
        const tol = tolOf(spec, l, scope, path, id, defaultTol(l.value, r.value));
        return { id, type: spec.type, pass: Math.abs(l.value - r.value) <= tol, expected: r.value, actual: l.value, residual: Math.abs(l.value - r.value), tolerance: tol, unit: dimLabel(l.dim), elements: [] };
      }
      const ok = { less: l.value < r.value, lessEqual: l.value <= r.value, greater: l.value > r.value, greaterEqual: l.value >= r.value }[spec.type];
      return { id, type: spec.type, pass: ok, expected: `${spec.type} ${r.value}`, actual: l.value, residual: ok ? 0 : Math.abs(l.value - r.value), tolerance: 0, unit: dimLabel(l.dim), elements: [] };
    }
    case "vectorSum": {
      const arrows = arrowQuantities(spec.vectors, res, id, `${path}.vectors`);
      const d = arrows[0]!.q.value.dim;
      for (const a of arrows) if (!qdimEqual(a.q.value.dim, d)) fail("E_UNIT_MISMATCH", [...owner, a.id], `"${a.id}" is ${dimLabel(a.q.value.dim)}, unlike "${arrows[0]!.id}" (${dimLabel(d)})`, { path: `${path}.vectors` });
      const sum = arrows.reduce((s, a) => ({ x: s.x + a.q.components.x, y: s.y + a.q.components.y }), { x: 0, y: 0 });
      const exp = spec.equals ? { x: q(spec.equals.x, `${path}.equals.x`), y: q(spec.equals.y, `${path}.equals.y`) } : { x: { value: 0, dim: d }, y: { value: 0, dim: d } };
      for (const c of [exp.x, exp.y]) if (c.value !== 0 && !qdimEqual(c.dim, d)) fail("E_UNIT_MISMATCH", owner, `Expected sum of "${id}" must be ${dimLabel(d)}`, { path: `${path}.equals` });
      const residual = Math.hypot(sum.x - exp.x.value, sum.y - exp.y.value);
      const tol = tolOf(spec, arrows[0]!.q.value, scope, path, id, defaultTol(...arrows.map(a => a.q.value.value)));
      return { id, type: spec.type, pass: residual <= tol, expected: { x: exp.x.value, y: exp.y.value }, actual: sum, residual, tolerance: tol, unit: dimLabel(d), elements: arrows.map(a => a.id) };
    }
    case "momentSum": {
      const arrows = arrowQuantities(spec.vectors, res, id, `${path}.vectors`);
      const about = resolvePoint(spec.about, res.instances, ctx, owner, `${path}.about`);
      const d = arrows[0]!.q.value.dim;
      for (const a of arrows) if (!qdimEqual(a.q.value.dim, d)) fail("E_UNIT_MISMATCH", [...owner, a.id], `"${a.id}" is ${dimLabel(a.q.value.dim)}, unlike "${arrows[0]!.id}"`, { path: `${path}.vectors` });
      const mdim = { base: { ...d.base, m: d.base.m + 1 }, angle: d.angle };
      let m = 0, scaleMag = 0;
      const parts: Record<string, number> = {};
      for (const a of arrows) {
        const rx = (a.q.tail.x - about.x) * ctx.worldUnitSI, ry = (a.q.tail.y - about.y) * ctx.worldUnitSI;
        const mi = rx * a.q.components.y - ry * a.q.components.x;
        parts[a.id] = mi; m += mi; scaleMag = Math.max(scaleMag, Math.abs(mi));
      }
      const expected = spec.equals === undefined ? 0 : q(spec.equals, `${path}.equals`);
      if (typeof expected !== "number" && expected.value !== 0 && !qdimEqual(expected.dim, mdim)) fail("E_UNIT_MISMATCH", owner, `Expected moment of "${id}" must be ${dimLabel(mdim)}`, { path: `${path}.equals` });
      const ev = typeof expected === "number" ? 0 : expected.value;
      const tol = tolOf(spec, { value: 0, dim: mdim }, scope, path, id, defaultTol(scaleMag));
      return { id, type: spec.type, pass: Math.abs(m - ev) <= tol, expected: ev, actual: { total: m, byVector: parts }, residual: Math.abs(m - ev), tolerance: tol, unit: dimLabel(mdim), elements: arrows.map(a => a.id) };
    }
    case "kcl": {
      if (!Array.isArray(spec.currents) || spec.currents.length === 0) fail("E_SCHEMA", owner, `${path}.currents must be a non-empty list`, { path });
      const cs = spec.currents.map((c, k) => {
        if (c?.direction !== "in" && c?.direction !== "out") fail("E_SCHEMA", owner, `${path}.currents[${k}].direction must be "in" or "out"`, { path: `${path}.currents[${k}]` });
        return { v: q(c.value, `${path}.currents[${k}].value`), sign: c.direction === "in" ? 1 : -1 };
      });
      for (const c of cs) if (!qdimEqual(c.v.dim, cs[0]!.v.dim)) fail("E_UNIT_MISMATCH", owner, `Currents in "${id}" mix ${dimLabel(cs[0]!.v.dim)} and ${dimLabel(c.v.dim)}`, { path });
      const into = cs.filter(c => c.sign > 0).reduce((s, c) => s + c.v.value, 0), out = cs.filter(c => c.sign < 0).reduce((s, c) => s + c.v.value, 0);
      const tol = tolOf(spec, cs[0]!.v, scope, path, id, defaultTol(into, out));
      return { id, type: spec.type, pass: Math.abs(into - out) <= tol, expected: { in: into }, actual: { out }, residual: Math.abs(into - out), tolerance: tol, unit: dimLabel(cs[0]!.v.dim), elements: spec.node ? [spec.node] : [] };
    }
    case "table": {
      if (typeof spec.fn !== "string" || typeof spec.var !== "string" || !Array.isArray(spec.rows) || spec.rows.length === 0) fail("E_SCHEMA", owner, `${path} needs "fn", "var" and non-empty "rows"`, { path });
      let worst = 0, worstRow = -1, tolUsed = 0, unit = "";
      const mismatches: { row: number; x: number; expected: number; actual: number }[] = [];
      for (const [k, row] of spec.rows.entries()) {
        if (!Array.isArray(row) || row.length !== 2) fail("E_SCHEMA", owner, `${path}.rows[${k}] must be [x, y]`, { path: `${path}.rows[${k}]` });
        const x = q(row[0], `${path}.rows[${k}][0]`), y = q(row[1], `${path}.rows[${k}][1]`);
        const f = evalQuantity(spec.fn, mapScope(new Map([[spec.var, x]]), scope), `${path}.fn`, owner);
        if (!qdimEqual(f.dim, y.dim)) fail("E_UNIT_MISMATCH", owner, `Row ${k} of "${id}": fn gives ${dimLabel(f.dim)}, table has ${dimLabel(y.dim)}`, { path: `${path}.rows[${k}]` });
        const tol = tolOf(spec, y, scope, path, id, defaultTol(f.value, y.value));
        const r = Math.abs(f.value - y.value);
        unit = dimLabel(y.dim);
        if (r > tol) mismatches.push({ row: k, x: x.value, expected: f.value, actual: y.value });
        if (r - tol > worst - tolUsed || worstRow < 0) { worst = r; worstRow = k; tolUsed = tol; }
      }
      return { id, type: spec.type, pass: mismatches.length === 0, expected: mismatches.length ? mismatches.map(m => ({ row: m.row, x: m.x, y: m.expected })) : "every row = fn(x)", actual: mismatches.length ? mismatches.map(m => ({ row: m.row, y: m.actual })) : `${spec.rows.length} rows match`, residual: worst, tolerance: tolUsed, unit, elements: [] };
    }
    case "proportional": {
      const arrows = arrowQuantities(spec.arrows, res, id, `${path}.arrows`);
      for (const a of arrows) if (!qdimEqual(a.q.value.dim, arrows[0]!.q.value.dim)) fail("E_UNIT_MISMATCH", [...owner, a.id], `"${a.id}" is ${dimLabel(a.q.value.dim)}, unlike "${arrows[0]!.id}"`, { path: `${path}.arrows` });
      const ratios = arrows.map(a => {
        const inst = res.instances.get(a.id)!, tip = res.defs.get(a.id)!.anchor(inst, "tip", undefined, ctx)!;
        const p = ctx.view.toView(a.q.tail), t = ctx.view.toView(tip);
        return Math.hypot(t.x - p.x, t.y - p.y) / a.q.value.value;
      });
      const worst = Math.max(...ratios.map(r => Math.abs(r - ratios[0]!) / ratios[0]!));
      const tol = spec.tol ?? 1e-6;
      return { id, type: spec.type, pass: worst <= tol, expected: ratios[0], actual: Object.fromEntries(arrows.map((a, k) => [a.id, ratios[k]])), residual: worst, tolerance: tol, unit: "relative", elements: arrows.map(a => a.id) };
    }
    case "onCurve": {
      const p = resolvePoint(spec.point, res.instances, ctx, owner, `${path}.point`);
      const cid = spec.curve, inst = typeof cid === "string" ? res.instances.get(cid) : undefined;
      if (!inst) fail("E_UNKNOWN_REF", owner, `${path}.curve names unknown element ${JSON.stringify(cid)}`, { path });
      const def = res.defs.get(inst.id)!;
      if (!def.curve) fail("E_SCHEMA", [...owner, inst.id], `"${inst.id}" (${inst.type}) is not a curve`, { path });
      const exact = def.curveResidual?.(inst, p);
      const dist = exact ?? pointPolylineDist(p, def.curve(inst, ctx));
      const tol = spec.tol === undefined ? 1e-6 / ctx.view.scale : evalLength(spec.tol, ctx, `${path}.tol`, owner);
      return { id, type: spec.type, pass: dist <= tol, expected: 0, actual: dist, residual: dist, tolerance: tol, unit: "world units", elements: [inst.id] };
    }
    default:
      return fail("E_SCHEMA", owner, `${path}.type ${JSON.stringify((spec as { type: unknown }).type)} is not a check type`, { path, suggestion: "Check types: equal, less, lessEqual, greater, greaterEqual, vectorSum, momentSum, kcl, table, proportional, onCurve." });
  }
}

