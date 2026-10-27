/**
 * Layout and overlap gate. Every drawn thing is a Body of view-space
 * collision shapes. Two bodies may touch only through an explicit relation:
 *  - element/element: `mayTouch` on either element
 *  - a label inside its own closed owner (the "center" position, fully contained)
 *  - a leader line with its owner and its label
 * The gate fails on any other overlap, on anything outside the canvas and on
 * any non-finite coordinate.
 */
import type { ToolkitIssue } from "./errors.js";
import { boxesNear, shapeBox, shapeDistance, shapeFinite, unionBox } from "./geometry.js";
import type { Box, CollisionShape } from "./geometry.js";

export type BodyKind = "element" | "label" | "leader" | "title" | "caption";

export interface Body {
  /** Unique body key: the element id, `label:<id>`, `leader:<id>`, `title`, `caption`. */
  key: string;
  kind: BodyKind;
  /** Element this body belongs to (labels and leaders: their owner). */
  owner: string;
  shapes: CollisionShape[];
  box: Box;
  /** Label placed inside its owner (explicit inside contact). */
  insideOwner?: boolean;
}

/** Required clear distance (px) between two bodies. */
export const CLEARANCE = { geometry: 0.5, text: 2 } as const;
/** Inset (px) from the canvas edge: labels as Scene2D keeps them, geometry at the edge. */
export const BOUNDS_INSET = { text: 2, geometry: 0 } as const;

export function makeBody(key: string, kind: BodyKind, owner: string, shapes: CollisionShape[], insideOwner = false): Body {
  const box = shapes.map(shapeBox).reduce(unionBox, { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  return { key, kind, owner, shapes, box, insideOwner };
}

const isText = (b: Body) => b.kind === "label" || b.kind === "title" || b.kind === "caption";

export interface Allowances { mayTouch: Map<string, Set<string>> }

/** Why two bodies may overlap, or undefined if they must not. */
export function contactReason(a: Body, b: Body, allow: Allowances): string | undefined {
  if (a.key === b.key) return "same body";
  const pair = (x: Body, y: Body): string | undefined => {
    if (x.kind === "element" && y.kind === "element" && (allow.mayTouch.get(x.owner)?.has(y.owner) || allow.mayTouch.get(y.owner)?.has(x.owner))) return "mayTouch";
    if (x.kind === "label" && x.insideOwner && y.kind === "element" && y.owner === x.owner) return "label inside its owner";
    if (x.kind === "leader" && (y.kind === "element" || y.kind === "label") && y.owner === x.owner) return "leader to its owner/label";
    return undefined;
  };
  return pair(a, b) ?? pair(b, a);
}

export function bodyDistance(a: Body, b: Body, stopBelow = 0): number {
  let d = Infinity;
  // Soft (grid) strokes are low priority: labels sit over them behind a halo,
  // and other elements' lines and fills may cross them. A part's own text
  // (strict) still keeps clear, because only labels get a halo.
  for (const s of a.shapes) for (const t of b.shapes) {
    if ((isSoft(s) && (!t.strict || s.kind === "area")) || (isSoft(t) && (!s.strict || t.kind === "area"))) continue;
    d = Math.min(d, shapeDistance(s, t)); if (d <= stopBelow) return d;
  }
  return d;
}

const isSoft = (s: CollisionShape) => s.kind !== "disc" && !!s.soft;

/** Does label body `label` sit over (within text clearance of) a soft grid stroke of `b`? */
export function overSoft(label: Body, b: Body): boolean {
  if (!boxesNear(label.box, b.box, CLEARANCE.text)) return false;
  return b.shapes.some(t => t.kind === "stroke" && isSoft(t) && label.shapes.some(s => shapeDistance(s, t) < CLEARANCE.text));
}

/** Distance between two bodies counting only pairs where one shape is strict. */
export function strictDistance(a: Body, b: Body): number {
  let d = Infinity;
  for (const s of a.shapes) for (const t of b.shapes) if (s.strict || t.strict) { d = Math.min(d, shapeDistance(s, t)); if (d === 0) return 0; }
  return d;
}

export function requiredGap(a: Body, b: Body): number {
  return isText(a) || isText(b) ? CLEARANCE.text : CLEARANCE.geometry;
}

/** Does body `a` collide with `b` (ignoring allowances)? */
export function collides(a: Body, b: Body): boolean {
  const gap = requiredGap(a, b);
  if (!boxesNear(a.box, b.box, gap)) return false;
  return bodyDistance(a, b, 0) < gap;
}

export function outOfBounds(b: Body, width: number, height: number): { overflow: number; side: string } | undefined {
  const inset = isText(b) ? BOUNDS_INSET.text : BOUNDS_INSET.geometry;
  const over = { left: inset - b.box.x0, top: inset - b.box.y0, right: b.box.x1 - (width - inset), bottom: b.box.y1 - (height - inset) };
  const worst = (Object.entries(over) as [string, number][]).sort((x, y) => y[1] - x[1])[0]!;
  return worst[1] > 1e-9 ? { overflow: worst[1], side: worst[0] } : undefined;
}

export interface GateResult {
  issues: ToolkitIssue[];
  contacts: { a: string; b: string; reason: string }[];
  stats: { bodies: number; shapes: number; pairsTested: number; collisions: number; outOfBounds: number; nonFinite: number };
}

const describeBody = (b: Body) => b.kind === "element" ? `"${b.owner}"` : b.kind === "label" ? `label of "${b.owner}"` : b.kind === "leader" ? `leader of "${b.owner}"` : b.kind;

export function runGate(bodies: Body[], width: number, height: number, allow: Allowances): GateResult {
  const issues: ToolkitIssue[] = [];
  const contacts: GateResult["contacts"] = [];
  const stats = { bodies: bodies.length, shapes: bodies.reduce((s, b) => s + b.shapes.length, 0), pairsTested: 0, collisions: 0, outOfBounds: 0, nonFinite: 0 };
  for (const b of bodies) {
    if (!b.shapes.every(shapeFinite)) {
      stats.nonFinite++;
      issues.push({ code: "E_NON_FINITE", elements: [b.owner], message: `${describeBody(b)} has non-finite coordinates`, suggestion: "Check the values that position this element." });
      continue;
    }
    const oob = outOfBounds(b, width, height);
    if (oob) {
      stats.outOfBounds++;
      issues.push({ code: "E_OUT_OF_BOUNDS", elements: [b.kind === "element" ? b.owner : b.key], message: `${describeBody(b)} extends ${oob.overflow.toFixed(1)} px past the ${oob.side} edge of the canvas`, measured: { overflowPx: oob.overflow, side: oob.side, box: b.box, canvas: { width, height } }, suggestion: b.kind === "caption" || b.kind === "title" ? `Shorten the ${b.kind} or widen the canvas by at least ${Math.ceil(oob.overflow * 2)} px.` : `Move it inward, enlarge the world bounds, or widen the canvas.` });
    }
  }
  const finite = bodies.filter(b => b.shapes.every(shapeFinite));
  for (let i = 0; i < finite.length; i++) for (let j = i + 1; j < finite.length; j++) {
    const a = finite[i]!, b = finite[j]!;
    const gap = requiredGap(a, b);
    if (!boxesNear(a.box, b.box, gap)) continue;
    stats.pairsTested++;
    const d = bodyDistance(a, b, 0);
    if (d >= gap) continue;
    const reason = contactReason(a, b, allow);
    // An allowed element contact never excuses touching a part's own text (strict shapes).
    const strictD = reason === "mayTouch" ? strictDistance(a, b) : Infinity;
    if (reason && strictD >= CLEARANCE.text) { contacts.push({ a: a.key, b: b.key, reason }); continue; }
    stats.collisions++;
    const both = a.kind === "element" && b.kind === "element";
    issues.push({
      code: "E_COLLISION", elements: [...new Set([a.kind === "element" ? a.owner : a.key, b.kind === "element" ? b.owner : b.key])],
      message: reason ? `${describeBody(a)} and ${describeBody(b)} may touch, but one of them runs through the other's text (${strictD.toFixed(2)} px; text needs ${CLEARANCE.text} px even between parts allowed to touch)` : `${describeBody(a)} ${d === 0 ? "overlaps" : `comes within ${d.toFixed(2)} px of`} ${describeBody(b)}${d === 0 ? "" : ` (needs ${gap} px)`}`,
      measured: { distancePx: d, requiredPx: gap, boxA: a.box, boxB: b.box },
      suggestion: reason ? `Move or resize one of them, change tick or label settings, or shorten the text so the line clears it.` : both ? `If this contact is intended (e.g. an arrow starting on its body), add "mayTouch": ["${b.owner}"] to "${a.owner}"; otherwise move one of them.` : `Move ${describeBody(a)} or ${describeBody(b)}, or shorten the text.`,
    });
  }
  return { issues, contacts, stats };
}
