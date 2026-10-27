/**
 * Constraint resolver. Point-defined parts take their geometry from point
 * references; origin-placed parts collect relations as loci for their origin
 * (a point, a line or a circle) and intersect them. Elements resolve in
 * dependency order. Errors name the elements and relations involved:
 * E_UNDERCONSTRAINED (a free direction remains), E_CONTRADICTORY (loci do not
 * meet), E_AMBIGUOUS (two discrete solutions, no `prefer`), E_CIRCULAR.
 */
import type { Vec2 } from "../diagram/primitives.js";
import { closestNames, fail } from "./errors.js";
import { evalAngle, evalLength, evalNumber } from "./expr.js";
import { COMMON_KEYS, getPart, listParts } from "./parts.js";
import type { PartContext, PartDefinition, PartInstance } from "./parts.js";
import type { ElementSpec, NumLike, PointRef, Relation, Side } from "./types.js";

const ID = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const REF = /^([A-Za-z_][A-Za-z0-9_-]*)(?:\.([A-Za-z_][A-Za-z0-9_]*)(?:\((.*)\))?)?$/;

export interface Resolved {
  instances: Map<string, PartInstance>;
  order: string[];
  defs: Map<string, PartDefinition>;
}

interface Located { el: ElementSpec; def: PartDefinition; props: unknown }

/** Element ids a point reference depends on. */
function refIds(ref: unknown): string[] {
  if (typeof ref === "string") { const m = REF.exec(ref.trim()); return m ? [m[1]!] : []; }
  if (ref && typeof ref === "object" && "ref" in ref && typeof (ref as { ref: unknown }).ref === "string") return refIds((ref as { ref: string }).ref);
  return [];
}

function relationsOf(el: ElementSpec): Relation[] {
  const list = el.place === undefined ? [] : Array.isArray(el.place) ? el.place : [el.place];
  return el.at !== undefined ? [{ at: el.at }, ...list] : list;
}

function relationDeps(r: Relation): string[] {
  const o = r as Record<string, unknown>;
  const ids: string[] = [];
  for (const k of ["at", "to", "alignedWith", "from"]) if (k in o) ids.push(...refIds(o[k]));
  if ("along" in o && o.along && typeof o.along === "object") ids.push(...refIds((o.along as { from: unknown }).from));
  for (const k of ["tangentTo", "leftOf", "rightOf", "above", "below"]) if (typeof o[k] === "string") ids.push(o[k] as string);
  return ids;
}

export function resolveLayout(elements: ElementSpec[], ctx: PartContext): Resolved {
  if (!Array.isArray(elements) || elements.length === 0) fail("E_SCHEMA", [], "The model needs a non-empty \"elements\" array", { path: "elements", suggestion: "Add \"elements\": [{\"id\": \"a\", \"type\": \"point\", \"at\": {\"x\": 0, \"y\": 0}}]." });
  const byId = new Map<string, Located>();
  const defs = new Map<string, PartDefinition>();
  for (const [k, el] of elements.entries()) {
    if (!el || typeof el !== "object") fail("E_SCHEMA", [], `elements[${k}] must be an object`, { path: `elements[${k}]` });
    if (typeof el.id !== "string" || !ID.test(el.id)) fail("E_SCHEMA", [String(el.id)], `elements[${k}].id must match ${ID} (no dots or spaces)`, { path: `elements[${k}].id`, measured: { id: el.id } });
    if (byId.has(el.id)) fail("E_DUPLICATE_ID", [el.id], `Two elements use the id "${el.id}"`, { path: `elements[${k}].id`, suggestion: `Rename one, e.g. "${el.id}2".` });
    const def = typeof el.type === "string" ? getPart(el.type) : undefined;
    if (!def) {
      const known = listParts().flatMap(p => [p.type, ...(p.aliases ?? [])]);
      fail("E_UNKNOWN_PART", [el.id], `Element "${el.id}" has unknown type ${JSON.stringify(el.type)}`, { path: `elements[${el.id}].type`, suggestion: `Known types: ${known.join(", ")}.${typeof el.type === "string" && closestNames(el.type, known).length ? ` Did you mean "${closestNames(el.type, known)[0]}"?` : ""}` });
    }
    const allowed = new Set([...COMMON_KEYS, ...def.propKeys]);
    for (const key of Object.keys(el)) if (!allowed.has(key)) fail("E_SCHEMA", [el.id], `"${key}" is not a property of ${el.type} "${el.id}"`, { path: `elements[${el.id}].${key}`, suggestion: `${el.type} accepts: ${[...allowed].join(", ")}.${closestNames(key, allowed).length ? ` Did you mean "${closestNames(key, allowed)[0]}"?` : ""}` });
    if (el.mayTouch !== undefined && (!Array.isArray(el.mayTouch) || el.mayTouch.some(m => typeof m !== "string"))) fail("E_SCHEMA", [el.id], `"mayTouch" of "${el.id}" must be a list of element ids`, { path: `elements[${el.id}].mayTouch` });
    if (el.prefer !== undefined && !["above", "below", "left", "right"].includes(el.prefer)) fail("E_SCHEMA", [el.id], `"prefer" of "${el.id}" must be above, below, left or right`, { path: `elements[${el.id}].prefer` });
    if (def.positioning === "points" && (el.place !== undefined || el.at !== undefined)) fail("E_SCHEMA", [el.id], `${el.type} "${el.id}" is positioned by its points, not by "place"/"at"`, { path: `elements[${el.id}].place`, suggestion: `Give ${(def.pointProps ?? []).map(p => p.name).join(", ") || "its geometry"} as point references instead.` });
    defs.set(el.id, def);
    byId.set(el.id, { el, def, props: def.props(el, ctx) });
  }
  for (const { el } of byId.values()) for (const m of el.mayTouch ?? []) if (!byId.has(m)) fail("E_UNKNOWN_REF", [el.id], `"${el.id}".mayTouch names unknown element "${m}"`, { path: `elements[${el.id}].mayTouch`, suggestion: closestNames(m, byId.keys()).length ? `Did you mean "${closestNames(m, byId.keys())[0]}"?` : undefined });

  // Dependencies, then a depth-first topological order with cycle reporting.
  const deps = new Map<string, string[]>();
  for (const { el, def } of byId.values()) {
    const ids = def.positioning === "points"
      ? (def.pointProps ?? []).flatMap(p => Array.isArray(el[p.name]) ? (el[p.name] as unknown[]).flatMap(refIds) : refIds(el[p.name]))
      : relationsOf(el).flatMap(relationDeps);
    if (def.elementRefs) ids.push(...def.elementRefs(el));
    for (const id of ids) if (!byId.has(id)) fail("E_UNKNOWN_REF", [el.id], `"${el.id}" refers to unknown element "${id}"`, { path: `elements[${el.id}]`, suggestion: closestNames(id, byId.keys()).length ? `Did you mean "${closestNames(id, byId.keys())[0]}"?` : `Define an element with id "${id}" or fix the reference.` });
    deps.set(el.id, [...new Set(ids)]);
  }
  const order: string[] = [];
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (id: string) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      const cycle = [...stack.slice(stack.indexOf(id)), id];
      fail("E_CIRCULAR", [...new Set(cycle)], `Placement depends on itself: ${cycle.join(" -> ")}`, { suggestion: `Place one of ${[...new Set(cycle)].map(c => `"${c}"`).join(", ")} with raw coordinates or relative to an element outside the cycle.` });
    }
    state.set(id, 1); stack.push(id);
    for (const d of deps.get(id)!) visit(d);
    stack.pop(); state.set(id, 2); order.push(id);
  };
  for (const el of elements) visit(el.id);

  const instances = new Map<string, PartInstance>();
  for (const id of order) {
    const { el, def, props } = byId.get(id)!;
    const inst: PartInstance = { id, type: el.type, spec: el, props, origin: { x: 0, y: 0 }, points: {} };
    if (def.positioning === "points") {
      for (const p of def.pointProps ?? []) {
        const v = el[p.name];
        if (v === undefined) { if (p.optional) continue; fail("E_SCHEMA", [id], `${el.type} "${id}" needs "${p.name}"`, { path: `elements[${id}].${p.name}`, suggestion: p.list ? `Add "${p.name}": a list of points such as [{"x":0,"y":0}, "block.top"].` : `Add "${p.name}": a point such as {"x":0,"y":0} or "block.top".` }); }
        if (p.list) {
          const min = p.min ?? 2;
          if (!Array.isArray(v) || v.length < min) fail("E_SCHEMA", [id], `"${p.name}" of "${id}" must list at least ${min === 1 ? "one point" : `${min} points`}`, { path: `elements[${id}].${p.name}` });
          inst.points[p.name] = (v as PointRef[]).map((r, k) => resolvePoint(r, instances, ctx, [id], `elements[${id}].${p.name}[${k}]`));
        } else inst.points[p.name] = resolvePoint(v as PointRef, instances, ctx, [id], `elements[${id}].${p.name}`);
      }
      const first = (def.pointProps ?? []).map(p => inst.points[p.name]).find(Boolean);
      inst.origin = Array.isArray(first) ? first[0]! : (first ?? { x: 0, y: 0 });
    } else {
      inst.origin = solvePlacement(inst, def, relationsOf(el), instances, defs, ctx);
    }
    if (def.link) def.link(inst, rid => { const other = instances.get(rid); if (!other) return fail("E_UNKNOWN_REF", [id], `"${id}" refers to unknown element "${rid}"`, { path: `elements[${id}]`, suggestion: closestNames(rid, byId.keys()).length ? `Did you mean "${closestNames(rid, byId.keys())[0]}"?` : `Define an element with id "${rid}".` }); return { inst: other, def: defs.get(rid)! }; }, ctx);
    if (![inst.origin.x, inst.origin.y].every(Number.isFinite)) fail("E_NON_FINITE", [id], `Position of "${id}" is not finite`, { measured: { origin: inst.origin } });
    instances.set(id, inst);
  }
  return { instances, order, defs };
}

/** Resolve a PointRef to world coordinates. */
export function resolvePoint(ref: PointRef, instances: Map<string, PartInstance>, ctx: PartContext, owner: string[], path: string): Vec2 {
  if (typeof ref === "string") return resolveAnchorRef(ref, instances, ctx, owner, path);
  if (ref && typeof ref === "object" && "ref" in ref) {
    const p = resolveAnchorRef(ref.ref, instances, ctx, owner, `${path}.ref`);
    return { x: p.x + (ref.dx === undefined ? 0 : evalLength(ref.dx, ctx, `${path}.dx`, owner)), y: p.y + (ref.dy === undefined ? 0 : evalLength(ref.dy, ctx, `${path}.dy`, owner)) };
  }
  if (ref && typeof ref === "object" && "x" in ref && "y" in ref) return { x: evalLength(ref.x, ctx, `${path}.x`, owner), y: evalLength(ref.y, ctx, `${path}.y`, owner) };
  return fail("E_SCHEMA", owner, `${path} is not a point`, { path, measured: { value: ref }, suggestion: "Use {\"x\": 1, \"y\": 2}, an anchor reference like \"block.top\", or {\"ref\": \"block.top\", \"dy\": 0.5}." });
}

function resolveAnchorRef(text: string, instances: Map<string, PartInstance>, ctx: PartContext, owner: string[], path: string): Vec2 {
  const m = REF.exec(text.trim());
  if (!m) fail("E_SCHEMA", owner, `"${text}" is not a reference`, { path, suggestion: "Write \"id\", \"id.anchor\" or \"id.anchor(arg)\", e.g. \"wheel.rim(30 deg)\"." });
  const [, id, name = "origin", argText] = m;
  const inst = instances.get(id!);
  if (!inst) return fail("E_UNKNOWN_REF", owner, `Unknown element "${id}" in "${text}"`, { path });
  const def = getPart(inst.type)!;
  let arg: number | undefined;
  if (argText !== undefined) {
    const kind = def.anchorArgs?.[name];
    if (!kind) fail("E_UNKNOWN_ANCHOR", [...owner, id!], `Anchor "${name}" of ${inst.type} "${id}" takes no argument`, { path, suggestion: `Anchors of ${inst.type}: ${def.anchorNames.join(", ")}.` });
    arg = kind === "angle" ? evalAngle(/^\s*-?\d+(\.\d+)?\s*$/.test(argText) ? Number(argText) : argText, ctx, path, owner) : kind === "length" ? evalLength(argText, ctx, path, owner) : evalNumber(argText, ctx, path, owner);
  } else if (def.anchorArgs?.[name]) fail("E_UNKNOWN_ANCHOR", [...owner, id!], `Anchor "${name}" of ${inst.type} "${id}" needs an argument, e.g. ${name}(${def.anchorArgs[name] === "angle" ? "30 deg" : "0.5"})`, { path });
  const p = def.anchor(inst, name, arg, ctx);
  if (!p) {
    const names = def.anchorNames.map(a => a.replace(/\(.*\)$/, ""));
    fail("E_UNKNOWN_ANCHOR", [...owner, id!], `${inst.type} "${id}" has no anchor "${name}${argText !== undefined ? `(${argText})` : ""}"`, { path, suggestion: `Anchors of ${inst.type}: ${def.anchorNames.join(", ")}.${closestNames(name, names).length ? ` Did you mean "${closestNames(name, names)[0]}"?` : ""}` });
  }
  return p;
}

// --- placement by loci ----------------------------------------------------------

type Locus =
  | { k: "plane" }
  | { k: "line"; p: Vec2; d: Vec2 }
  | { k: "circle"; c: Vec2; r: number }
  | { k: "points"; pts: Vec2[] };

const sub = (a: Vec2, b: Vec2) => ({ x: a.x - b.x, y: a.y - b.y });
const addv = (a: Vec2, b: Vec2) => ({ x: a.x + b.x, y: a.y + b.y });
const crossv = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
const dotv = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
const norm = (a: Vec2) => Math.hypot(a.x, a.y);

function distToLocus(p: Vec2, l: Locus): number {
  if (l.k === "plane") return 0;
  if (l.k === "line") return Math.abs(crossv(l.d, sub(p, l.p)));
  if (l.k === "circle") return Math.abs(norm(sub(p, l.c)) - l.r);
  return Math.min(...l.pts.map(q => norm(sub(p, q))));
}

function intersect(a: Locus, b: Locus, tol: number): Locus | { k: "none"; residual: number } {
  if (a.k === "plane") return b;
  if (b.k === "plane") return a;
  if (a.k === "points" || b.k === "points") {
    const [pts, other] = a.k === "points" ? [a, b] : [b as Extract<Locus, { k: "points" }>, a];
    const keep = pts.pts.filter(p => distToLocus(p, other) <= tol);
    return keep.length ? { k: "points", pts: keep } : { k: "none", residual: Math.min(...pts.pts.map(p => distToLocus(p, other))) };
  }
  if (a.k === "line" && b.k === "line") {
    const c = crossv(a.d, b.d);
    if (Math.abs(c) < 1e-12) return distToLocus(b.p, a) <= tol ? a : { k: "none", residual: distToLocus(b.p, a) };
    const t = crossv(sub(b.p, a.p), b.d) / c;
    return { k: "points", pts: [addv(a.p, { x: a.d.x * t, y: a.d.y * t })] };
  }
  if (a.k === "circle" && b.k === "line") return intersect(b, a, tol);
  if (a.k === "line" && b.k === "circle") {
    const t0 = dotv(sub(b.c, a.p), a.d);
    const foot = addv(a.p, { x: a.d.x * t0, y: a.d.y * t0 });
    const h = norm(sub(b.c, foot));
    if (h > b.r + tol) return { k: "none", residual: h - b.r };
    if (Math.abs(h - b.r) <= tol) return { k: "points", pts: [foot] };
    const s = Math.sqrt(b.r * b.r - h * h);
    return { k: "points", pts: [addv(foot, { x: a.d.x * s, y: a.d.y * s }), addv(foot, { x: -a.d.x * s, y: -a.d.y * s })] };
  }
  if (a.k === "circle" && b.k === "circle") {
    const dv = sub(b.c, a.c), d = norm(dv);
    if (d <= tol) return Math.abs(a.r - b.r) <= tol ? a : { k: "none", residual: Math.abs(a.r - b.r) };
    if (d > a.r + b.r + tol) return { k: "none", residual: d - a.r - b.r };
    if (d < Math.abs(a.r - b.r) - tol) return { k: "none", residual: Math.abs(a.r - b.r) - d };
    const x = (d * d + a.r * a.r - b.r * b.r) / (2 * d);
    const h = Math.sqrt(Math.max(0, a.r * a.r - x * x));
    const u = { x: dv.x / d, y: dv.y / d }, m = addv(a.c, { x: u.x * x, y: u.y * x });
    if (h <= tol) return { k: "points", pts: [m] };
    return { k: "points", pts: [addv(m, { x: -u.y * h, y: u.x * h }), addv(m, { x: u.y * h, y: -u.x * h })] };
  }
  return a;
}

function describe(r: Relation): string {
  return JSON.stringify(r);
}

function solvePlacement(inst: PartInstance, def: PartDefinition, relations: Relation[], instances: Map<string, PartInstance>, defs: Map<string, PartDefinition>, ctx: PartContext): Vec2 {
  const id = inst.id;
  // Consistency tolerance: a millionth of a pixel, in world units.
  const tol = 1e-6 / ctx.view.scale;
  const local: PartInstance = { ...inst, origin: { x: 0, y: 0 } };
  const ownAnchor = (name: string | undefined, path: string): Vec2 => {
    if (name === undefined || name === "origin") return { x: 0, y: 0 };
    const p = def.anchor(local, name, undefined, ctx);
    if (!p) fail("E_UNKNOWN_ANCHOR", [id], `${inst.type} "${id}" has no anchor "${name}"`, { path, suggestion: `Anchors of ${inst.type}: ${def.anchorNames.join(", ")}.` });
    return p;
  };
  const lbox = def.box(local, ctx);
  const otherBox = (oid: string) => defs.get(oid)!.box(instances.get(oid)!, ctx);
  const loci: { locus: Locus; idx: number; refs: string[] }[] = [];
  const post: ((origin: Vec2) => void)[] = [];
  const pt = (r: PointRef, path: string) => resolvePoint(r, instances, ctx, [id], path);

  for (const [idx, rel] of relations.entries()) {
    const path = `elements[${id}].place[${idx}]`;
    const o = rel as Record<string, unknown>;
    const refs = relationDeps(rel);
    const pushPoint = (p: Vec2, off: Vec2) => loci.push({ locus: { k: "points", pts: [sub(p, off)] }, idx, refs });
    const pushLine = (p: Vec2, d: Vec2, off: Vec2) => { const l = norm(d); loci.push({ locus: { k: "line", p: sub(p, off), d: { x: d.x / l, y: d.y / l } }, idx, refs }); };
    if ("at" in o) pushPoint(pt(o.at as PointRef, `${path}.at`), ownAnchor(o.anchor as string | undefined, `${path}.anchor`));
    else if ("attach" in o) {
      if (typeof o.attach !== "string" || o.to === undefined) fail("E_SCHEMA", [id], `${path}: "attach" names an own anchor and needs "to"`, { path, suggestion: "Example: {\"attach\": \"bottom\", \"to\": \"ground.mid\"}." });
      pushPoint(pt(o.to as PointRef, `${path}.to`), ownAnchor(o.attach as string, `${path}.attach`));
    } else if ("x" in o && !("y" in o)) pushLine({ x: evalLength(o.x as NumLike, ctx, `${path}.x`, [id]), y: 0 }, { x: 0, y: 1 }, ownAnchor(o.anchor as string | undefined, `${path}.anchor`));
    else if ("y" in o && !("x" in o)) pushLine({ x: 0, y: evalLength(o.y as NumLike, ctx, `${path}.y`, [id]) }, { x: 1, y: 0 }, ownAnchor(o.anchor as string | undefined, `${path}.anchor`));
    else if ("along" in o) {
      const a = o.along as { from: PointRef; angle: NumLike; distance?: NumLike };
      if (!a || typeof a !== "object" || a.from === undefined || a.angle === undefined) fail("E_SCHEMA", [id], `${path}.along needs "from" and "angle"`, { path });
      const from = pt(a.from, `${path}.along.from`), ang = evalAngle(a.angle, ctx, `${path}.along.angle`, [id]);
      const u = { x: Math.cos(ang), y: Math.sin(ang) }, off = ownAnchor(o.anchor as string | undefined, `${path}.anchor`);
      if (a.distance !== undefined) { const d = evalLength(a.distance, ctx, `${path}.along.distance`, [id]); pushPoint(addv(from, { x: u.x * d, y: u.y * d }), off); }
      else {
        pushLine(from, u, off);
        post.push(origin => { const t = dotv(sub(addv(origin, off), from), u); if (t < -tol) fail("E_CONTRADICTORY", [id, ...refs], `"${id}" would lie behind the start of its "along" ray (t = ${t.toPrecision(4)})`, { path, measured: { t }, suggestion: "Add 180 deg to the angle, or change the other relation." }); });
      }
    } else if ("alignedWith" in o) {
      if (o.axis !== "x" && o.axis !== "y") fail("E_SCHEMA", [id], `${path}.axis must be "x" (share x, stacked vertically) or "y" (share y, side by side)`, { path });
      const p = pt(o.alignedWith as PointRef, `${path}.alignedWith`), off = ownAnchor(o.anchor as string | undefined, `${path}.anchor`);
      pushLine(p, o.axis === "x" ? { x: 0, y: 1 } : { x: 1, y: 0 }, off);
    } else if ("distance" in o) {
      if (o.from === undefined) fail("E_SCHEMA", [id], `${path}: "distance" needs "from"`, { path });
      const c = pt(o.from as PointRef, `${path}.from`), d = evalLength(o.distance as NumLike, ctx, `${path}.distance`, [id]);
      if (!(d >= 0)) fail("E_INVALID_VALUE", [id], `${path}.distance must not be negative`, { path, measured: { distance: d } });
      loci.push({ locus: { k: "circle", c: sub(c, ownAnchor(o.anchor as string | undefined, `${path}.anchor`)), r: d }, idx, refs });
    } else if ("tangentTo" in o) {
      const tid = o.tangentTo as string, tdef = defs.get(tid)!, tinst = instances.get(tid)!;
      if (!def.radius) fail("E_SCHEMA", [id], `${inst.type} "${id}" is not round, so it cannot be tangent to "${tid}"`, { path, suggestion: "Use tangentTo on circle-like parts; place other parts with attach/at." });
      const r = def.radius(local);
      if (tdef.radius) {
        const R = tdef.radius(tinst), mode = o.mode ?? "external";
        if (mode !== "external" && mode !== "internal") fail("E_SCHEMA", [id], `${path}.mode must be "external" or "internal"`, { path });
        const center = tdef.anchor(tinst, "center", undefined, ctx) ?? tinst.origin;
        loci.push({ locus: { k: "circle", c: center, r: mode === "external" ? R + r : Math.abs(R - r) }, idx, refs });
      } else if (tdef.segment) {
        const [a, b] = tdef.segment(tinst);
        const dir = sub(b, a), len = norm(dir);
        if (len === 0) fail("E_INVALID_VALUE", [id, tid], `"${tid}" has zero length`, { path });
        const n = { x: -dir.y / len, y: dir.x / len };
        const side = o.side as Side | undefined;
        if (!side) fail("E_AMBIGUOUS", [id, tid], `"${id}" can touch "${tid}" from either side`, { path, suggestion: `Add "side": ${Math.abs(n.y) > 1e-9 ? "\"above\" or \"below\"" : "\"left\" or \"right\""} to the tangentTo relation.` });
        const sign = side === "above" ? Math.sign(n.y) : side === "below" ? -Math.sign(n.y) : side === "left" ? -Math.sign(n.x) : side === "right" ? Math.sign(n.x) : NaN;
        if (!(sign === 1 || sign === -1)) fail("E_SCHEMA", [id, tid], `side "${side}" is undefined for "${tid}" (it runs ${Math.abs(n.y) < 1e-9 ? "vertically" : "horizontally"})`, { path, suggestion: `Use ${Math.abs(n.y) > 1e-9 ? "\"above\" or \"below\"" : "\"left\" or \"right\""}.` });
        const off = { x: n.x * r * sign, y: n.y * r * sign };
        pushLine(addv(a, off), dir, { x: 0, y: 0 });
        post.push(origin => {
          const t = dotv(sub(origin, a), dir) / (len * len);
          if (t < -1e-9 || t > 1 + 1e-9) fail("E_CONTRADICTORY", [id, tid], `"${id}" touches the line through "${tid}" outside the segment (at t = ${t.toFixed(3)} of its length)`, { path, measured: { t }, suggestion: `Move "${id}" along "${tid}" (e.g. with alignedWith or along) or extend "${tid}".` });
        });
      } else fail("E_SCHEMA", [id, tid], `"${tid}" (${tinst.type}) is neither round nor straight; tangency is undefined`, { path });
    } else if ("leftOf" in o || "rightOf" in o || "above" in o || "below" in o) {
      const dirKey = (["leftOf", "rightOf", "above", "below"] as const).find(k => k in o)!;
      const oid = o[dirKey] as string, ob = otherBox(oid);
      const gap = o.gap === undefined ? 0 : evalLength(o.gap as NumLike, ctx, `${path}.gap`, [id]);
      const align = (o.align ?? "center") as string;
      if (!["center", "start", "end", "none"].includes(align)) fail("E_SCHEMA", [id], `${path}.align must be center, start, end or none`, { path });
      const horizontal = dirKey === "leftOf" || dirKey === "rightOf";
      if (horizontal) {
        const x = dirKey === "leftOf" ? ob.x0 - gap - lbox.x1 : ob.x1 + gap - lbox.x0;
        loci.push({ locus: { k: "line", p: { x, y: 0 }, d: { x: 0, y: 1 } }, idx, refs });
        if (align !== "none") { const y = align === "center" ? (ob.y0 + ob.y1) / 2 - (lbox.y0 + lbox.y1) / 2 : align === "start" ? ob.y0 - lbox.y0 : ob.y1 - lbox.y1; loci.push({ locus: { k: "line", p: { x: 0, y }, d: { x: 1, y: 0 } }, idx, refs }); }
      } else {
        const y = dirKey === "above" ? ob.y1 + gap - lbox.y0 : ob.y0 - gap - lbox.y1;
        loci.push({ locus: { k: "line", p: { x: 0, y }, d: { x: 1, y: 0 } }, idx, refs });
        if (align !== "none") { const x = align === "center" ? (ob.x0 + ob.x1) / 2 - (lbox.x0 + lbox.x1) / 2 : align === "start" ? ob.x0 - lbox.x0 : ob.x1 - lbox.x1; loci.push({ locus: { k: "line", p: { x, y: 0 }, d: { x: 0, y: 1 } }, idx, refs }); }
      }
    } else if ("inside" in o) {
      // Containment is verified after resolution (compose checks it).
    } else fail("E_SCHEMA", [id], `${path} is not a known relation: ${describe(rel)}`, { path, suggestion: "Relations: at, attach/to, x, y, along, alignedWith, distance, tangentTo, leftOf, rightOf, above, below, inside." });
  }

  let cur: Locus = { k: "plane" };
  const used: { idx: number; refs: string[] }[] = [];
  for (const l of loci) {
    const next = intersect(cur, l.locus, tol);
    if (next.k === "none") {
      const involved = [...used, l];
      const others = [...new Set(involved.flatMap(u => u.refs))];
      fail("E_CONTRADICTORY", [id, ...others], `Relations ${[...new Set(involved.map(u => u.idx))].map(i => `place[${i}]`).join(", ")} of "${id}" cannot all hold (they miss by ${next.residual.toPrecision(4)} world units)`, {
        path: `elements[${id}].place`, measured: { residual: next.residual, relations: [...new Set(involved.map(u => u.idx))].map(i => relations[i]) },
        suggestion: `Remove or change one of these relations; place[${l.idx}] is the first that conflicts.`,
      });
    }
    cur = next;
    used.push(l);
  }
  let origin: Vec2;
  if (cur.k === "points") {
    const pts = cur.pts.filter((p, k) => cur.k === "points" && cur.pts.findIndex(q => norm(sub(p, q)) <= tol) === k);
    if (pts.length === 1) origin = pts[0]!;
    else {
      const prefer = inst.spec.prefer;
      const key = (p: Vec2) => prefer === "above" ? p.y : prefer === "below" ? -p.y : prefer === "right" ? p.x : prefer === "left" ? -p.x : NaN;
      const sorted = [...pts].sort((a, b) => key(b) - key(a));
      if (!prefer || Math.abs(key(sorted[0]!) - key(sorted[1]!)) <= tol) {
        const dy = Math.abs(pts[0]!.y - pts[1]!.y), dx = Math.abs(pts[0]!.x - pts[1]!.x);
        fail("E_AMBIGUOUS", [id, ...new Set(used.flatMap(u => u.refs))], `"${id}" has ${pts.length} possible positions`, { path: `elements[${id}].prefer`, measured: { candidates: pts }, suggestion: `Add "prefer": ${dy >= dx ? "\"above\" or \"below\"" : "\"left\" or \"right\""} to "${id}".` });
      }
      origin = sorted[0]!;
    }
  } else {
    const free = cur.k === "plane" ? "both x and y are free" : cur.k === "line" ? (Math.abs(cur.d.y) < 1e-9 ? "x is free (it can slide horizontally)" : Math.abs(cur.d.x) < 1e-9 ? "y is free (it can slide vertically)" : "it can slide along a line") : "it can slide around a circle";
    fail("E_UNDERCONSTRAINED", [id, ...new Set(used.flatMap(u => u.refs))], `Position of "${id}" is not determined: ${free}`, {
      path: `elements[${id}].place`, measured: { freeDegrees: cur.k === "plane" ? 2 : 1, relations: relations.length },
      suggestion: cur.k === "plane" ? `Add "at": {"x": ..., "y": ...} or a relation such as {"rightOf": "<id>", "gap": 0.5}.` : cur.k === "line" && Math.abs(cur.d.y) < 1e-9 ? `Fix x: add {"x": ...}, {"alignedWith": "<ref>", "axis": "x"} or leftOf/rightOf.` : cur.k === "line" && Math.abs(cur.d.x) < 1e-9 ? `Fix y: add {"y": ...}, {"alignedWith": "<ref>", "axis": "y"} or above/below.` : `Add another relation that crosses this ${cur.k}, e.g. {"x": ...} or "along" with a distance.`,
    });
  }
  for (const check of post) check(origin);
  return origin;
}
