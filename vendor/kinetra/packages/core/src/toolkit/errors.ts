/**
 * Structured toolkit errors. Every failure names the elements involved,
 * what is wrong, the measured values, and a concrete fix an agent can apply.
 */

export const TOOLKIT_ERROR_CODES = {
  E_SCHEMA: "The model does not have the required shape (missing or mistyped field).",
  E_DUPLICATE_ID: "Two elements share one id.",
  E_UNKNOWN_PART: "An element uses a part type that is not registered.",
  E_UNKNOWN_REF: "A reference names an element that does not exist.",
  E_UNKNOWN_ANCHOR: "A reference names an anchor the part does not expose.",
  E_EXPR_PARSE: "An expression could not be parsed.",
  E_EXPR_UNKNOWN_NAME: "An expression uses a name that is neither a variable, a reference nor a unit.",
  E_UNIT_MISMATCH: "Units are incompatible (adding unlike quantities, or a value of the wrong dimension).",
  E_NON_FINITE: "A value evaluated to NaN or Infinity.",
  E_INVALID_VALUE: "A value is finite but outside its allowed range (e.g. a negative radius).",
  E_SCALE_MISSING: "A quantity arrow has no declared scale for its quantity type.",
  E_UNDERCONSTRAINED: "An element's position is not fully determined.",
  E_CONTRADICTORY: "An element's constraints cannot all hold at once.",
  E_AMBIGUOUS: "Constraints allow several discrete positions; a `prefer` hint is needed.",
  E_CIRCULAR: "Elements or variables depend on each other in a cycle.",
  E_CONSTRAINT_VIOLATED: "A containment relation (`inside`) does not hold after resolution.",
  E_CHECK_FAILED: "A declared check (invariant) does not hold.",
  E_TEXT_UNSUPPORTED: "Label text uses markup that cannot be rendered in the Kinetra font.",
  E_STYLE: "A colour, stroke width or font size is outside the Kinetra style contract.",
  E_ARROW_TOO_SHORT: "An arrow is too short on screen for its arrowhead to read.",
  E_COLLISION: "Two elements overlap without a declared `mayTouch` relation.",
  E_OUT_OF_BOUNDS: "An element or label extends outside the canvas.",
  E_LABEL_UNPLACEABLE: "No free position was found for a label, even with a leader line.",
} as const;

export type ToolkitErrorCode = keyof typeof TOOLKIT_ERROR_CODES;

export interface ToolkitIssue {
  code: ToolkitErrorCode;
  /** Element ids (or `var:<name>`, `check:<id>`, `label:<id>`) involved. */
  elements: string[];
  message: string;
  /** Measured values that show the problem (pixels, world units or SI). */
  measured?: Record<string, unknown>;
  /** A concrete change that would fix it. */
  suggestion?: string;
  /** JSON path into the model, when one applies. */
  path?: string;
}

/** Thrown internally; compose() converts it to a ToolkitIssue. */
export class ToolkitFailure extends Error {
  readonly issue: ToolkitIssue;
  constructor(issue: ToolkitIssue) {
    super(`${issue.code}: ${issue.message}`);
    this.name = "ToolkitFailure";
    this.issue = issue;
  }
}

export function fail(code: ToolkitErrorCode, elements: string[], message: string, extra: Omit<ToolkitIssue, "code" | "elements" | "message"> = {}): never {
  throw new ToolkitFailure({ code, elements, message, ...extra });
}

/** Closest names by edit distance, for "did you mean" suggestions. */
export function closestNames(name: string, candidates: Iterable<string>, max = 3): string[] {
  const d = (a: string, b: string) => {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0]!;
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = row[j]!;
        row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return row[b.length]!;
  };
  return [...new Set(candidates)].map(c => [c, d(name.toLowerCase(), c.toLowerCase())] as const)
    .filter(([c, n]) => n <= Math.max(2, Math.floor(c.length / 2)))
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).slice(0, max).map(([c]) => c);
}
