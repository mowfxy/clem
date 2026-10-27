/**
 * Label placement. Each label has an anchor, ordered candidate positions and
 * a priority. Labels are placed greedily (highest priority first), then a
 * local search moves one already-placed label to free a blocked one, and
 * finally a short leader line is tried. Physics geometry never moves; only
 * labels (and their leaders) do.
 */
import type { Vec2 } from "../diagram/primitives.js";
import type { ToolkitIssue } from "./errors.js";
import { containedIn } from "./geometry.js";
import type { Box } from "./geometry.js";
import { collides, contactReason, makeBody, outOfBounds } from "./gate.js";
import type { Allowances, Body } from "./gate.js";
import { textBox } from "./parts.js";
import { plainLabelText } from "./text_metrics.js";
import type { LabelPosition } from "./types.js";

export const LABEL_POSITIONS: LabelPosition[] = ["right", "above-right", "above", "above-left", "left", "below-left", "below", "below-right", "center"];

export interface LabelRequest {
  owner: string;
  text: string;
  size: number;
  color: string;
  priority: number;
  order: number;
  candidates: LabelPosition[];
  pinned?: LabelPosition;
  leader: boolean;
  /** Anchor point (view px). */
  anchor: Vec2;
  /** Extent the label must clear (view px): the owner's box for closed parts, else the inflated anchor. */
  extent: Box;
  /** Owner outline (view px) for "center" labels inside closed parts. */
  outline?: Vec2[];
}

export interface PlacedLabel {
  request: LabelRequest;
  position: LabelPosition | "leader";
  /** Text baseline start point (view px, text-anchor start). */
  baseline: Vec2;
  body: Body;
  leader?: { from: Vec2; to: Vec2; body: Body };
}

/** Gap (px) between a label and the extent it labels. */
export const LABEL_GAP = 3;
const LEADER_STEPS = [12, 22, 34, 48];
const LEADER_MIN = 6;

const DIRS: Record<LabelPosition, Vec2> = { right: { x: 1, y: 0 }, "above-right": { x: 1, y: -1 }, above: { x: 0, y: -1 }, "above-left": { x: -1, y: -1 }, left: { x: -1, y: 0 }, "below-left": { x: -1, y: 1 }, below: { x: 0, y: 1 }, "below-right": { x: 1, y: 1 }, center: { x: 0, y: 0 } };

function metrics(r: LabelRequest) {
  const tb = textBox(0, 0, r.text, r.size, "start");
  return { tb, W: tb.x1 - tb.x0, H: tb.y1 - tb.y0 };
}

function bodyAt(r: LabelRequest, L: number, T: number, inside: boolean): { body: Body; baseline: Vec2 } {
  const { tb, W, H } = metrics(r);
  const box = { x0: L, y0: T, x1: L + W, y1: T + H };
  return { body: makeBody(`label:${r.owner}`, "label", r.owner, [{ kind: "area", points: [{ x: box.x0, y: box.y0 }, { x: box.x1, y: box.y0 }, { x: box.x1, y: box.y1 }, { x: box.x0, y: box.y1 }] }], inside), baseline: { x: L - tb.x0, y: T - tb.y0 } };
}

function candidateBody(r: LabelRequest, pos: LabelPosition): { body: Body; baseline: Vec2 } | undefined {
  const { W, H } = metrics(r);
  const E = r.extent, a = r.anchor, g = LABEL_GAP, d = g * 0.6;
  let L: number, T: number;
  switch (pos) {
    case "right": L = E.x1 + g; T = a.y - H / 2; break;
    case "left": L = E.x0 - g - W; T = a.y - H / 2; break;
    case "above": L = a.x - W / 2; T = E.y0 - g - H; break;
    case "below": L = a.x - W / 2; T = E.y1 + g; break;
    case "above-right": L = E.x1 + d; T = E.y0 - d - H; break;
    case "above-left": L = E.x0 - d - W; T = E.y0 - d - H; break;
    case "below-right": L = E.x1 + d; T = E.y1 + d; break;
    case "below-left": L = E.x0 - d - W; T = E.y1 + d; break;
    case "center": {
      if (!r.outline) return undefined;
      L = a.x - W / 2; T = a.y - H / 2;
      const c = bodyAt(r, L, T, true);
      const poly = (c.body.shapes[0] as { points: Vec2[] }).points;
      return containedIn(poly, r.outline, 2) ? c : undefined;
    }
  }
  return bodyAt(r, L, T, false);
}

interface World { obstacles: Body[]; width: number; height: number; allow: Allowances }

function blockers(b: Body, w: World, extra: Body[] = []): Body[] {
  return [...w.obstacles, ...extra].filter(o => o.key !== b.key && !contactReason(b, o, w.allow) && collides(b, o));
}

function exitPoint(from: Vec2, u: Vec2, outline: Vec2[] | undefined): Vec2 {
  if (!outline) return from;
  let t = 0;
  const inside = (p: Vec2) => containedIn([p], outline, 0);
  while (t < 4000 && inside({ x: from.x + u.x * t, y: from.y + u.y * t })) t += 0.5;
  return { x: from.x + u.x * t, y: from.y + u.y * t };
}

function leaderOptions(r: LabelRequest): { label: { body: Body; baseline: Vec2 }; from: Vec2; to: Vec2; leader: Body }[] {
  const { W, H } = metrics(r);
  const pref = DIRS[r.candidates.find(c => c !== "center") ?? "right"];
  const prefAngle = Math.atan2(pref.y, pref.x);
  const dirs = Array.from({ length: 16 }, (_, k) => k * Math.PI / 8)
    .sort((a, b) => angDist(a, prefAngle) - angDist(b, prefAngle) || a - b);
  const half = Math.hypot(r.extent.x1 - r.extent.x0, r.extent.y1 - r.extent.y0) / 2;
  const out: ReturnType<typeof leaderOptions> = [];
  for (const step of LEADER_STEPS) for (const ang of dirs) {
    const u = { x: Math.cos(ang), y: Math.sin(ang) };
    // Push the box out until its nearest point is `step` px beyond the extent.
    const reach = half + step + Math.abs(u.x) * W / 2 + Math.abs(u.y) * H / 2;
    const c = { x: r.anchor.x + u.x * reach, y: r.anchor.y + u.y * reach };
    const label = bodyAt(r, c.x - W / 2, c.y - H / 2, false);
    const from = exitPoint(r.anchor, u, r.outline);
    const b = label.body.box;
    const to = { x: Math.max(b.x0, Math.min(b.x1, from.x)), y: Math.max(b.y0, Math.min(b.y1, from.y)) };
    if (Math.hypot(to.x - from.x, to.y - from.y) < LEADER_MIN) continue;
    out.push({ label, from, to, leader: makeBody(`leader:${r.owner}`, "leader", r.owner, [{ kind: "stroke", points: [from, to], r: 0.4 }]) });
  }
  return out;
}

const angDist = (a: number, b: number) => { const d = Math.abs(a - b) % (2 * Math.PI); return Math.min(d, 2 * Math.PI - d); };

function fits(b: Body, w: World, extra: Body[] = []): boolean {
  return !outOfBounds(b, w.width, w.height) && blockers(b, w, extra).length === 0;
}

const describe = (b: Body) => b.kind === "element" ? b.owner : b.key;

export function placeLabels(requests: LabelRequest[], obstacles: Body[], width: number, height: number, allow: Allowances): { placed: PlacedLabel[]; issues: ToolkitIssue[] } {
  const w: World = { obstacles, width, height, allow };
  const placed = new Map<string, PlacedLabel>();
  const issues: ToolkitIssue[] = [];
  const queue = [...requests].sort((a, b) => b.priority - a.priority || a.order - b.order);
  const placedBodies = (except?: string) => [...placed.values()].filter(p => p.request.owner !== except).flatMap(p => p.leader ? [p.body, p.leader.body] : [p.body]);
  const freePositions = (r: LabelRequest, except?: string) => LABEL_POSITIONS.filter(pos => { const c = candidateBody(r, pos); return c && fits(c.body, w, placedBodies(except ?? r.owner)); });

  const unplaced: LabelRequest[] = [];
  for (const r of queue) {
    if (r.pinned) {
      const c = candidateBody(r, r.pinned);
      const others = placedBodies(r.owner);
      if (c && fits(c.body, w, others)) { placed.set(r.owner, { request: r, position: r.pinned, baseline: c.baseline, body: c.body }); continue; }
      const free = freePositions(r);
      const oob = c ? outOfBounds(c.body, width, height) : undefined;
      const hits = c ? blockers(c.body, w, others).map(describe) : [];
      issues.push({
        code: !c ? "E_LABEL_UNPLACEABLE" : oob && hits.length === 0 ? "E_OUT_OF_BOUNDS" : "E_COLLISION",
        elements: [`label:${r.owner}`, ...hits],
        message: !c ? `label "${plainLabelText(r.text)}" of "${r.owner}" cannot sit at "${r.pinned}" (it does not fit inside its owner)` : `label "${plainLabelText(r.text)}" of "${r.owner}" at "${r.pinned}" ${hits.length ? `overlaps ${hits.map(h => `"${h}"`).join(", ")}` : `extends ${oob!.overflow.toFixed(1)} px past the ${oob!.side} edge`}; free positions: ${free.length ? free.join(", ") : "none"}`,
        measured: { position: r.pinned, box: c?.body.box, blockers: hits, freePositions: free },
        suggestion: free.length ? `Set "position": "${free[0]}" or remove "position" to let the placer choose.` : "Remove \"position\" so a leader line can be used, or move nearby elements.",
      });
      continue;
    }
    let done = false;
    for (const pos of r.candidates) {
      const c = candidateBody(r, pos);
      if (c && fits(c.body, w, placedBodies(r.owner))) { placed.set(r.owner, { request: r, position: pos, baseline: c.baseline, body: c.body }); done = true; break; }
    }
    if (!done) unplaced.push(r);
  }

  // Local search: free a blocked candidate by moving exactly one placed label.
  for (const r of [...unplaced]) {
    let done = false;
    for (const pos of r.candidates) {
      const c = candidateBody(r, pos);
      if (!c || outOfBounds(c.body, width, height) || blockers(c.body, w).length) continue;
      const hit = [...placed.values()].filter(p => !p.request.pinned && (collides(c.body, p.body) || (p.leader && collides(c.body, p.leader.body))));
      if (hit.length !== 1 || placedBodies(r.owner).filter(b => b.owner !== hit[0]!.request.owner).some(b => collides(c.body, b))) continue;
      const other = hit[0]!;
      for (const opos of other.request.candidates) {
        if (opos === other.position) continue;
        const oc = candidateBody(other.request, opos);
        if (oc && fits(oc.body, w, [...placedBodies(other.request.owner).filter(b => b.owner !== other.request.owner), c.body])) {
          placed.set(other.request.owner, { request: other.request, position: opos, baseline: oc.baseline, body: oc.body });
          placed.set(r.owner, { request: r, position: pos, baseline: c.baseline, body: c.body });
          done = true;
          break;
        }
      }
      if (done) break;
    }
    if (done) unplaced.splice(unplaced.indexOf(r), 1);
  }

  // Leader lines for what is left.
  for (const r of unplaced) {
    const others = placedBodies(r.owner);
    const option = r.leader ? leaderOptions(r).find(o => fits(o.label.body, w, others) && fits(o.leader, w, [...others])) : undefined;
    if (option) { placed.set(r.owner, { request: r, position: "leader", baseline: option.label.baseline, body: option.label.body, leader: { from: option.from, to: option.to, body: option.leader } }); continue; }
    const tried = r.candidates.map(pos => { const c = candidateBody(r, pos); return { position: pos, blockedBy: c ? [...blockers(c.body, w, others).map(describe), ...(outOfBounds(c.body, width, height) ? ["canvas edge"] : [])] : ["not inside owner"] }; });
    const near = [...new Set(tried.flatMap(t => t.blockedBy))];
    issues.push({
      code: "E_LABEL_UNPLACEABLE", elements: [`label:${r.owner}`, ...near.filter(n => n !== "canvas edge" && n !== "not inside owner")],
      message: `No free position for label "${plainLabelText(r.text)}" of "${r.owner}"${r.leader ? ", even with a leader line" : " (leader lines disabled)"}`,
      measured: { tried },
      suggestion: `Space out ${near.slice(0, 4).map(n => `"${n}"`).join(", ")}, shorten the label, lower another label's priority, or enlarge the canvas.`,
    });
  }
  return { placed: [...placed.values()], issues };
}
