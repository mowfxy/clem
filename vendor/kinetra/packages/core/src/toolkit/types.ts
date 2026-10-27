/**
 * Composition model: a JSON-serialisable description of any 2D diagram as
 * named parts placed by relations. See docs/toolkit/engine.md.
 */

/** A number, or an expression string with units such as "2.5 m", "30 deg", "m*g". */
export type NumLike = number | string;

export interface PointLiteral { x: NumLike; y: NumLike }
/**
 * A point: raw world coordinates, an anchor reference such as "block.top",
 * "wheel.rim(30 deg)" or "beam" (its origin), or a reference with an offset.
 */
export type PointRef = string | PointLiteral | { ref: string; dx?: NumLike; dy?: NumLike };

export type Side = "above" | "below" | "left" | "right";

/** Placement relations for parts positioned by an origin. `anchor` names the
 * part's own anchor that the relation constrains (default: its origin). */
export type Relation =
  | { at: PointRef; anchor?: string }
  | { attach: string; to: PointRef }
  | { x: NumLike; anchor?: string }
  | { y: NumLike; anchor?: string }
  | { along: { from: PointRef; angle: NumLike; distance?: NumLike }; anchor?: string }
  | { alignedWith: PointRef; axis: "x" | "y"; anchor?: string }
  | { distance: NumLike; from: PointRef; anchor?: string }
  | { tangentTo: string; side?: Side; mode?: "external" | "internal" }
  | { leftOf: string; gap?: NumLike; align?: "center" | "start" | "end" | "none" }
  | { rightOf: string; gap?: NumLike; align?: "center" | "start" | "end" | "none" }
  | { above: string; gap?: NumLike; align?: "center" | "start" | "end" | "none" }
  | { below: string; gap?: NumLike; align?: "center" | "start" | "end" | "none" }
  | { inside: string; margin?: NumLike };

export type LabelPosition = "right" | "above-right" | "above" | "above-left" | "left" | "below-left" | "below" | "below-right" | "center";

export interface LabelSpec {
  text: string;
  /** Pin one position. If it collides, the error lists the free positions. */
  position?: LabelPosition;
  /** Ordered candidate positions; defaults depend on the part. */
  candidates?: LabelPosition[];
  /** Higher priority labels are placed first (default 0). */
  priority?: number;
  /** Anchor the label points at; defaults to the part's label anchor. */
  anchor?: string;
  size?: 11 | 12 | 13;
  color?: string;
  /** Allow a leader line if no direct position is free (default true). */
  leader?: boolean;
}

export interface ElementSpec {
  id: string;
  type: string;
  /** Placement for origin-positioned parts. Shorthand: `at`. */
  place?: Relation | Relation[];
  at?: PointRef;
  /** Resolve a two-way ambiguity (e.g. a line meeting a circle twice). */
  prefer?: Side;
  label?: string | LabelSpec;
  /** Element ids this element may legitimately touch or overlap. */
  mayTouch?: string[];
  color?: string;
  /** Part-specific properties (size, points, magnitude, ...). */
  [prop: string]: unknown;
}

export interface ScaleSpec {
  /** Quantity per one world unit of arrow length, e.g. "10 N". */
  per: NumLike;
}

export type CheckSpec =
  | { id?: string; type: "equal"; left: NumLike; right: NumLike; tol?: NumLike }
  | { id?: string; type: "less" | "lessEqual" | "greater" | "greaterEqual"; left: NumLike; right: NumLike }
  | { id?: string; type: "vectorSum"; vectors: string[]; equals?: { x: NumLike; y: NumLike }; tol?: NumLike }
  | { id?: string; type: "momentSum"; about: PointRef; vectors: string[]; equals?: NumLike; tol?: NumLike }
  | { id?: string; type: "kcl"; node?: string; currents: { value: NumLike; direction: "in" | "out" }[]; tol?: NumLike }
  | { id?: string; type: "table"; fn: string; var: string; rows: [NumLike, NumLike][]; tol?: NumLike }
  | { id?: string; type: "proportional"; arrows: string[]; tol?: number }
  | { id?: string; type: "onCurve"; point: PointRef; curve: string; tol?: NumLike };

export interface ComposeModel {
  version?: 1;
  canvas: {
    width: number;
    height: number;
    world: { xMin: NumLike; xMax: NumLike; yMin: NumLike; yMax: NumLike };
    /** Physical length of one world unit for dimensioned lengths (default "m"). */
    worldUnit?: string;
  };
  title?: string;
  caption?: string;
  /** Named values; may reference each other and units. */
  vars?: Record<string, NumLike>;
  /** One arrow scale per quantity type, keyed by quantity name (force, velocity, ...). */
  scales?: Record<string, ScaleSpec>;
  elements: ElementSpec[];
  checks?: CheckSpec[];
}
