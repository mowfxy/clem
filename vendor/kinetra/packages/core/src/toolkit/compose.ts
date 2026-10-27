/**
 * compose(model): resolve a composition, verify its declared checks, place
 * labels, run the overlap gate and render through renderScene2D. It returns
 * { ok: true, svg, report } only when every check and the gate pass;
 * otherwise { ok: false, errors, report } with structured, fixable errors.
 */
import { addShape, newScene2D, renderScene2D, sceneTransform, viewToWorld, worldToView } from "../diagram/scene2d.js";
import type { Scene2DModel } from "../diagram/scene2d.js";
import type { Vec2 } from "../diagram/primitives.js";
import { ToolkitFailure, fail } from "./errors.js";
import type { ToolkitIssue } from "./errors.js";
import { LENGTH, dimLabel, evalLength, evalQuantity, qdimEqual, unitQuantity, variableScope } from "./expr.js";
import type { TkQuantity } from "./expr.js";
import { containedIn } from "./geometry.js";
import { elementScope, runChecks } from "./checks.js";
import type { CheckResult } from "./checks.js";
import { makeBody, overSoft, runGate } from "./gate.js";
import type { Body, GateResult } from "./gate.js";
import { placeLabels } from "./labels.js";
import type { LabelRequest } from "./labels.js";
import { colorProp, textBoxPolygon } from "./parts.js";
import type { PartContext, ViewMap } from "./parts.js";
import { resolveLayout } from "./resolver.js";
import type { Resolved } from "./resolver.js";
import { TOOLKIT_TEXT, checkToolkitStyle } from "./style.js";
import { formatLabelMarkup, measureTitleWidth, plainLabelText, renderScriptTspans } from "./text_metrics.js";
import type { ComposeModel, LabelPosition, LabelSpec } from "./types.js";

export interface ComposeReport {
  canvas: { width: number; height: number; world: { xMin: number; xMax: number; yMin: number; yMax: number }; pxPerWorldUnit: number; worldUnit: string };
  elements: { id: string; type: string; origin: Vec2; points?: Record<string, Vec2 | Vec2[]> }[];
  labels: { owner: string; text: string; position: string; box: { x0: number; y0: number; x1: number; y1: number }; leader?: { from: Vec2; to: Vec2 } }[];
  scales: { quantity: string; per: string; perSI: number; unit: string }[];
  checks: CheckResult[];
  contacts: { a: string; b: string; reason: string }[];
  gate?: GateResult["stats"];
  caption?: string;
  stage: "input" | "resolve" | "checks" | "labels" | "gate" | "render" | "done";
}

export type ComposeResult =
  | { ok: true; svg: string; report: ComposeReport }
  | { ok: false; errors: ToolkitIssue[]; report: ComposeReport };

const LEADER_COLOR = "#777";
const LEADER_WIDTH = 0.8;

export function compose(model: ComposeModel): ComposeResult {
  const report: ComposeReport = { canvas: { width: 0, height: 0, world: { xMin: 0, xMax: 0, yMin: 0, yMax: 0 }, pxPerWorldUnit: 0, worldUnit: "m" }, elements: [], labels: [], scales: [], checks: [], contacts: [], stage: "input" };
  try {
    return composeInner(model, report);
  } catch (e) {
    if (e instanceof ToolkitFailure) return { ok: false, errors: [e.issue], report };
    throw e;
  }
}

function composeInner(model: ComposeModel, report: ComposeReport): ComposeResult {
  if (!model || typeof model !== "object") fail("E_SCHEMA", [], "The model must be an object", { path: "" });
  const known = new Set(["version", "canvas", "title", "caption", "vars", "scales", "elements", "checks", "$schema", "description"]);
  for (const k of Object.keys(model)) if (!known.has(k)) fail("E_SCHEMA", [], `Unknown top-level key "${k}"`, { path: k, suggestion: `Top-level keys: ${[...known].filter(x => x !== "$schema").join(", ")}.` });
  if (model.version !== undefined && model.version !== 1) fail("E_SCHEMA", [], "Only composition version 1 is supported", { path: "version" });
  const c = model.canvas;
  if (!c || typeof c !== "object") fail("E_SCHEMA", [], "\"canvas\" is required", { path: "canvas", suggestion: "Add \"canvas\": {\"width\": 800, \"height\": 500, \"world\": {\"xMin\": 0, \"xMax\": 8, \"yMin\": 0, \"yMax\": 5}}." });
  for (const k of ["width", "height"] as const) if (typeof c[k] !== "number" || !Number.isFinite(c[k]) || c[k] < 50 || c[k] > 4000) fail("E_SCHEMA", [], `canvas.${k} must be a number of pixels in [50, 4000]`, { path: `canvas.${k}`, measured: { [k]: c[k] } });
  for (const k of ["title", "caption"] as const) if (model[k] !== undefined && (typeof model[k] !== "string" || model[k] === "")) fail("E_SCHEMA", [], `"${k}" must be a non-empty string`, { path: k });
  if (model.vars !== undefined && (typeof model.vars !== "object" || Array.isArray(model.vars))) fail("E_SCHEMA", [], "\"vars\" must be an object of name: value", { path: "vars" });
  for (const name of Object.keys(model.vars ?? {})) if (!/^[A-Za-z_Ͱ-Ͽ][A-Za-z0-9_Ͱ-Ͽ]*$/.test(name)) fail("E_SCHEMA", [`var:${name}`], `Variable name "${name}" is not an identifier`, { path: `vars.${name}`, suggestion: "Use letters, digits and _ (no dots), e.g. \"m1\" or \"theta\"." });

  const scope0 = variableScope(model.vars ?? {});
  const worldUnit = c.worldUnit ?? "m";
  const wu = unitQuantity(worldUnit);
  if (!wu || !qdimEqual(wu.dim, LENGTH)) fail("E_UNIT_MISMATCH", [], `canvas.worldUnit "${worldUnit}" is not a length unit`, { path: "canvas.worldUnit", suggestion: "Use m, cm, mm or km." });
  const vctx = { scope: scope0, worldUnitSI: wu.value };
  if (!c.world || typeof c.world !== "object") fail("E_SCHEMA", [], "canvas.world {xMin, xMax, yMin, yMax} is required", { path: "canvas.world" });
  const world = { xMin: 0, xMax: 0, yMin: 0, yMax: 0 };
  for (const k of ["xMin", "xMax", "yMin", "yMax"] as const) {
    if (c.world[k] === undefined) fail("E_SCHEMA", [], `canvas.world.${k} is required`, { path: `canvas.world.${k}` });
    world[k] = evalLength(c.world[k], vctx, `canvas.world.${k}`, []);
  }
  if (!(world.xMax > world.xMin) || !(world.yMax > world.yMin)) fail("E_INVALID_VALUE", [], "canvas.world must have xMax > xMin and yMax > yMin", { path: "canvas.world", measured: world });

  const scene: Scene2DModel = newScene2D({ width: c.width, height: c.height, world, title: model.title, caption: undefined });
  // Clem: the toolkit places its own labels, so the scene must not move them.
  scene.fixedLabels = true;
  const t = sceneTransform(scene);
  const view: ViewMap = { toView: p => worldToView(scene, p), toWorld: p => viewToWorld(scene, p), scale: t.sx };
  report.canvas = { width: c.width, height: c.height, world, pxPerWorldUnit: t.sx, worldUnit };

  const scales = new Map<string, { per: TkQuantity; text: string }>();
  if (model.scales !== undefined && (typeof model.scales !== "object" || Array.isArray(model.scales))) fail("E_SCHEMA", [], "\"scales\" must be an object such as {\"force\": {\"per\": \"10 N\"}}", { path: "scales" });
  for (const [name, spec] of Object.entries(model.scales ?? {})) {
    if (!spec || typeof spec !== "object" || spec.per === undefined) fail("E_SCHEMA", [], `scales.${name} needs "per"`, { path: `scales.${name}`, suggestion: `Write "scales": {"${name}": {"per": "10 N"}} meaning 10 N per world unit of arrow.` });
    const per = evalQuantity(spec.per, scope0, `scales.${name}.per`, [`scale:${name}`]);
    if (!(per.value > 0)) fail("E_INVALID_VALUE", [`scale:${name}`], `scales.${name}.per must be positive`, { path: `scales.${name}.per` });
    scales.set(name, { per, text: typeof spec.per === "number" ? String(spec.per) : spec.per.trim() });
    report.scales.push({ quantity: name, per: typeof spec.per === "number" ? String(spec.per) : spec.per, perSI: per.value, unit: dimLabel(per.dim) });
  }
  const tl = view.toWorld({ x: 0, y: 0 }), br = view.toWorld({ x: c.width, y: c.height });
  const ctx: PartContext = { ...vctx, view, scales, canvas: { x0: tl.x, y0: br.y, x1: br.x, y1: tl.y } };

  // 1. Resolve geometry.
  report.stage = "resolve";
  const res = resolveLayout(model.elements, ctx);
  for (const id of res.order) {
    const inst = res.instances.get(id)!;
    report.elements.push({ id, type: inst.type, origin: inst.origin, ...(Object.keys(inst.points).length ? { points: inst.points } : {}) });
  }
  checkInside(model, res, ctx);
  for (const id of res.order) res.defs.get(id)!.gate?.(res.instances.get(id)!, ctx);

  // 2. Declared and automatic checks.
  report.stage = "checks";
  const { results, issues: checkIssues } = runChecks(model.checks, res, ctx, elementScope(res, ctx, scope0));
  report.checks = results;
  if (checkIssues.length) return { ok: false, errors: checkIssues, report };

  // 3. Fixed bodies: elements, title, caption.
  const usedScales = [...scales.entries()].filter(([name]) => res.order.some(id => res.defs.get(id)!.quantity?.(res.instances.get(id)!)?.quantity === name));
  const unused = [...scales.keys()].filter(n => !usedScales.some(([u]) => u === n));
  if (unused.length) fail("E_SCHEMA", unused.map(n => `scale:${n}`), `Declared scale${unused.length > 1 ? "s" : ""} ${unused.map(n => `"${n}"`).join(", ")} ${unused.length > 1 ? "are" : "is"} not used by any arrow`, { path: "scales", suggestion: "Remove unused scales so the caption only states scales that appear in the diagram." });
  const scaleText = usedScales.length ? `Arrow scale: ${usedScales.map(([name, s]) => `1 unit = ${s.text} (${name})`).join("; ")}` : "";
  const caption = [model.caption, scaleText].filter(Boolean).join(" · ") || undefined;
  report.caption = caption;
  const bodies: Body[] = [];
  for (const id of res.order) bodies.push(makeBody(id, "element", id, res.defs.get(id)!.collide(res.instances.get(id)!, ctx)));
  if (model.title) {
    const w = measureTitleWidth(model.title, TOOLKIT_TEXT.title.size), y = TOOLKIT_TEXT.title.y, s = TOOLKIT_TEXT.title.size;
    bodies.push(makeBody("title", "title", "title", [{ kind: "area", points: [{ x: c.width / 2 - w / 2, y: y - s * 0.95 }, { x: c.width / 2 + w / 2, y: y - s * 0.95 }, { x: c.width / 2 + w / 2, y: y + s * 0.25 }, { x: c.width / 2 - w / 2, y: y + s * 0.25 }] }]));
  }
  if (caption) bodies.push(makeBody("caption", "caption", "caption", [{ kind: "area", points: textBoxPolygon(c.width / 2, c.height - TOOLKIT_TEXT.caption.bottomOffset, caption, TOOLKIT_TEXT.caption.size, "middle") }]));
  const allow = { mayTouch: new Map(res.order.map(id => [id, new Set([...(res.instances.get(id)!.spec.mayTouch ?? []), ...(res.instances.get(id)!.touches ?? [])])])) };
  // Built-in contact rules of the parts themselves (no model mayTouch needed).
  const builtIn = new Map<string, string>();
  for (const [k, a] of res.order.entries()) for (const b of res.order.slice(k + 1)) {
    const ia = res.instances.get(a)!, ib = res.instances.get(b)!;
    const why = res.defs.get(a)!.contactWith?.(ia, ib, ctx) ?? res.defs.get(b)!.contactWith?.(ib, ia, ctx);
    if (!why) continue;
    allow.mayTouch.get(a)!.add(b); allow.mayTouch.get(b)!.add(a);
    builtIn.set(`${a}|${b}`, why); builtIn.set(`${b}|${a}`, why);
  }
  const named = (cs: GateResult["contacts"]) => cs.map(x => x.reason === "mayTouch" && builtIn.has(`${x.a}|${x.b}`) ? { ...x, reason: builtIn.get(`${x.a}|${x.b}`)! } : x);
  // Geometry must be clean before labels are placed, so the root cause is reported.
  report.stage = "gate";
  const fixedGate = runGate(bodies, c.width, c.height, allow);
  if (fixedGate.issues.length) { report.gate = fixedGate.stats; report.contacts = named(fixedGate.contacts); return { ok: false, errors: fixedGate.issues, report }; }

  // 4. Labels.
  report.stage = "labels";
  const requests: LabelRequest[] = [];
  for (const [order, id] of res.order.entries()) {
    const inst = res.instances.get(id)!, def = res.defs.get(id)!;
    if (inst.spec.label === undefined) continue;
    const spec: LabelSpec = typeof inst.spec.label === "string" ? { text: inst.spec.label } : inst.spec.label as LabelSpec;
    if (!spec || typeof spec.text !== "string" || spec.text === "") fail("E_SCHEMA", [id], `label of "${id}" needs non-empty "text"`, { path: `elements[${id}].label` });
    if (!def.label) fail("E_SCHEMA", [id], `${inst.type} "${id}" does not take a label`, { path: `elements[${id}].label`, suggestion: "Use a separate text element." });
    const size = spec.size ?? TOOLKIT_TEXT.defaultLabelSize;
    if (!(TOOLKIT_TEXT.labelSizes as readonly number[]).includes(size)) fail("E_STYLE", [id], `Label size ${size} on "${id}" is not in the style contract`, { path: `elements[${id}].label.size`, suggestion: "Use 11, 12 or 13." });
    const color = spec.color === undefined ? (inst.spec.color !== undefined ? colorProp(inst.spec, "color", "#222") : "#222") : colorProp({ ...inst.spec, labelColor: spec.color }, "labelColor", "#222");
    const base = def.label(inst, ctx);
    const anchorWorld = spec.anchor ? def.anchor(inst, spec.anchor, undefined, ctx) : base.anchor;
    if (!anchorWorld) fail("E_UNKNOWN_ANCHOR", [id], `label anchor "${spec.anchor}" is not an anchor of ${inst.type} "${id}"`, { path: `elements[${id}].label.anchor`, suggestion: `Anchors: ${def.anchorNames.join(", ")}.` });
    const anchor = view.toView(anchorWorld);
    const outline = def.outline?.(inst).map(p => view.toView(p));
    const atCenter = !!outline && Math.hypot(anchorWorld.x - (def.anchor(inst, "center", undefined, ctx) ?? inst.origin).x, anchorWorld.y - (def.anchor(inst, "center", undefined, ctx) ?? inst.origin).y) < 1e-9;
    const extent = outline && atCenter
      ? { x0: Math.min(...outline.map(p => p.x)), y0: Math.min(...outline.map(p => p.y)), x1: Math.max(...outline.map(p => p.x)), y1: Math.max(...outline.map(p => p.y)) }
      : smallOwnerExtent(anchor, bodies.find(b => b.key === id)!.box);
    const valid = (p: unknown): p is LabelPosition => ["right", "above-right", "above", "above-left", "left", "below-left", "below", "below-right", "center"].includes(p as string);
    if (spec.position !== undefined && !valid(spec.position)) fail("E_SCHEMA", [id], `label position ${JSON.stringify(spec.position)} of "${id}" is not a position`, { path: `elements[${id}].label.position`, suggestion: "Positions: right, above-right, above, above-left, left, below-left, below, below-right, center." });
    if (spec.candidates !== undefined && (!Array.isArray(spec.candidates) || !spec.candidates.every(valid))) fail("E_SCHEMA", [id], `label candidates of "${id}" must be a list of positions`, { path: `elements[${id}].label.candidates` });
    const candidates = (spec.candidates ?? base.candidates).filter(p => p !== "center" || (outline && atCenter));
    requests.push({ owner: id, text: formatLabelMarkup(spec.text, [id]), size, color, priority: spec.priority ?? 0, order, candidates, pinned: spec.position, leader: spec.leader !== false, anchor, extent, outline: atCenter ? outline : undefined });
  }
  const { placed, issues: labelIssues } = placeLabels(requests, bodies, c.width, c.height, allow);
  report.labels = placed.map(p => ({ owner: p.request.owner, text: plainLabelText(p.request.text), position: p.position, box: p.body.box, ...(p.leader ? { leader: { from: p.leader.from, to: p.leader.to } } : {}) }));
  if (labelIssues.length) return { ok: false, errors: labelIssues, report };

  // 5. Gate over everything that will be drawn.
  report.stage = "gate";
  const all = [...bodies, ...placed.flatMap(p => p.leader ? [p.body, p.leader.body] : [p.body])];
  const gate = runGate(all, c.width, c.height, allow);
  report.gate = gate.stats;
  report.contacts = named(gate.contacts);
  if (gate.issues.length) return { ok: false, errors: gate.issues, report };

  // 6. Render through the template pipeline.
  report.stage = "render";
  scene.caption = caption;
  for (const id of res.order) for (const sh of res.defs.get(id)!.draw(res.instances.get(id)!, ctx)) addShape(scene, sh);
  for (const p of placed) if (p.leader) addShape(scene, { kind: "segment", from: view.toWorld(p.leader.from), to: view.toWorld(p.leader.to), color: LEADER_COLOR, width: LEADER_WIDTH });
  // A label over grid lines gets a white halo covering its whole collision box (glyphs and backdrop).
  for (const p of placed) if (bodies.some(b => b.kind === "element" && overSoft(p.body, b))) {
    const bx = p.body.box, lo = view.toWorld({ x: bx.x0, y: bx.y1 }), hi = view.toWorld({ x: bx.x1, y: bx.y0 });
    addShape(scene, { kind: "rect", origin: lo, size: { w: hi.x - lo.x, h: hi.y - lo.y }, fill: "#fff", stroke: "none" });
  }
  for (const p of placed) addShape(scene, { kind: "label", at: view.toWorld(p.baseline), text: p.request.text, color: p.request.color, size: p.request.size, anchor: "start" });
  const svg = renderScriptTspans(renderScene2D(scene));
  const style = checkToolkitStyle(svg, { title: model.title, caption });
  if (style.length) fail("E_STYLE", [], `Rendered SVG violates the style contract: ${style.map(v => v.detail).join("; ")}`, { measured: { violations: style } });
  report.stage = "done";
  return { ok: true, svg, report };
}

/**
 * Label extent for an open part: the anchor inflated by 3 px, grown to the
 * owner's own box when that box is marker-sized (at most 24 px each way) and
 * holds the anchor, so a label clears its own marker (circle, cross, x).
 */
function smallOwnerExtent(anchor: Vec2, box: { x0: number; y0: number; x1: number; y1: number }) {
  const e = { x0: anchor.x - 3, y0: anchor.y - 3, x1: anchor.x + 3, y1: anchor.y + 3 };
  const small = box.x1 - box.x0 <= 24 && box.y1 - box.y0 <= 24;
  const holds = anchor.x >= box.x0 && anchor.x <= box.x1 && anchor.y >= box.y0 && anchor.y <= box.y1;
  return small && holds ? { x0: Math.min(e.x0, box.x0), y0: Math.min(e.y0, box.y0), x1: Math.max(e.x1, box.x1), y1: Math.max(e.y1, box.y1) } : e;
}

function checkInside(model: ComposeModel, res: Resolved, ctx: PartContext): void {
  for (const id of res.order) {
    const inst = res.instances.get(id)!, def = res.defs.get(id)!;
    const rels = inst.spec.place === undefined ? [] : Array.isArray(inst.spec.place) ? inst.spec.place : [inst.spec.place];
    for (const [k, rel] of rels.entries()) {
      if (!("inside" in rel)) continue;
      const oid = rel.inside, other = res.instances.get(oid);
      if (!other) fail("E_UNKNOWN_REF", [id], `"${id}" is placed inside unknown element "${oid}"`, { path: `elements[${id}].place[${k}]` });
      const odef = res.defs.get(oid)!;
      if (!odef.outline) fail("E_SCHEMA", [id, oid], `"${oid}" (${other.type}) is not a closed shape, so nothing can be inside it`, { path: `elements[${id}].place[${k}]` });
      const margin = rel.margin === undefined ? 0 : evalLength(rel.margin, ctx, `elements[${id}].place[${k}].margin`, [id]);
      const b = def.box(inst, ctx);
      const corners = [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }];
      if (!containedIn(corners, odef.outline(other), margin)) fail("E_CONSTRAINT_VIOLATED", [id, oid], `"${id}" is not inside "${oid}"${margin ? ` with margin ${margin}` : ""}`, { path: `elements[${id}].place[${k}]`, measured: { box: b, container: odef.box(other, ctx) }, suggestion: `Move "${id}" so its bounding box lies within "${oid}", or shrink it.` });
    }
  }
}
